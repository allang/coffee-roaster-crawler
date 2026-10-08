const { getSupabase } = require('./supabase');
const globalLogger = require('./logger');
const crypto = require('crypto');
const { fetchSourceImage,validateImage } = require('./sourceImage');
const {imageUrl:resolveImageUrl}=require('./productImages');

const BUCKET_NAME = 'assets';
const IMAGE_TTL_MS=7*86400_000;

async function downloadAndSaveImage(productId, imageUrl, log = null, options={}) {
  const logger = log || globalLogger;
  
  if (!imageUrl) {
    return null;
  }

  const normalizedUrl=resolveImageUrl(imageUrl,options.sourceUrl);
  if(!normalizedUrl){logger.warn('ImageDownloader','Invalid source image URL',{productId});return null;}

  const supabase = options.db || getSupabase();

  try {
    const {data:cached,error:cacheError}=await supabase.from('media_source_cache').select('media_asset_id,checked_at').eq('source_url',normalizedUrl).maybeSingle();
    if(cacheError) throw cacheError;
    const age=Date.now()-Date.parse(cached?.checked_at);
    if(!options.verifyFresh && cached && age>=0 && age<IMAGE_TTL_MS) {
      if(await linkProductMedia(productId,cached.media_asset_id,logger,supabase)) return cached.media_asset_id;
      return null;
    }
    const cacheAndLink=async assetId=>{
      if(!await linkProductMedia(productId,assetId,logger,supabase)) return null;
      const {error}=await supabase.from('media_source_cache').upsert({source_url:normalizedUrl,media_asset_id:assetId,checked_at:new Date().toISOString()},{onConflict:'source_url'});
      if(error)logger.warn('ImageDownloader','Photo linked; source cache update failed',{productId,error:error.message});
      return assetId;
    };
    const result = await (options.fetchImage || fetchSourceImage)(normalizedUrl, {
      timeout: 30000,
      referer: options.sourceUrl,
    });

    if (!result.success) {
      logger.warn('ImageDownloader', `Failed to download image: ${result.error}`, { url: normalizedUrl.substring(0, 100) });
      return null;
    }

    const buffer = Buffer.from(result.data);
    const format=await validateImage(buffer);
    if(!format) {logger.warn('ImageDownloader','Response is not a supported product image',{productId});return null;}
    const contentHash = crypto.createHash('md5').update(buffer).digest('hex');

    const contentType = format.contentType;
    const ext = format.extension;
    const fileName = `products/${productId}/${contentHash}${ext}`;

    const { data: existingAssets,error:assetReadError } = await supabase
      .from('media_assets')
      .select('id, url')
      .eq('content_hash', contentHash)
      .order('id');
    if(assetReadError)throw assetReadError;
    const existingAsset=existingAssets?.[0];

    if (existingAsset) {
      const linked=await cacheAndLink(existingAsset.id);
      logger.info('ImageDownloader', `Reused existing asset: ${contentHash}`);
      return linked;
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType: contentType,
        upsert: true,
      });

    if (uploadError) {
      logger.error('ImageDownloader', 'Failed to upload image', { error: uploadError.message });
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    const publicUrl = publicUrlData.publicUrl;

    const { data: mediaAsset, error: insertError } = await supabase
      .from('media_assets')
      .insert({
        url: publicUrl,
        content_hash: contentHash,
        width:format.width,height:format.height,
      })
      .select('id')
      .single();

    if (insertError) {
      logger.error('ImageDownloader', 'Failed to create media_asset', { error: insertError.message });
      return null;
    }

    const linked=await cacheAndLink(mediaAsset.id);
    logger.success('ImageDownloader', `Saved image: ${fileName}`);
    return linked;

  } catch (error) {
    logger.warn('ImageDownloader', `Failed to download image: ${error.message}`, { url: normalizedUrl.substring(0, 100) });
    return null;
  }
}

async function linkProductMedia(productId, mediaAssetId, logger, supabase=getSupabase()) {

  const { data: existingLink,error:readError } = await supabase
    .from('product_media')
    .select('product_id')
    .eq('product_id', productId)
    .eq('media_asset_id', mediaAssetId)
    .maybeSingle();
  if(readError)throw readError;

  if (existingLink) {
    return true;
  }

  const {data:links,error:linksError}=await supabase.from('product_media').select('sort_order').eq('product_id',productId);
  if(linksError)throw linksError;
  const sortOrder=links?.length?Math.max(...links.map(l=>Number(l.sort_order)||0))+1:0;
  const { error } = await supabase
    .from('product_media')
    .upsert({
      product_id: productId,
      media_asset_id: mediaAssetId,
      sort_order: sortOrder,
    },{onConflict:'product_id,media_asset_id',ignoreDuplicates:true});

  if (error) {
    logger.warn('ImageDownloader', 'Failed to link product_media', { error: error.message });
    return false;
  }
  
  return true;
}

module.exports = {
  downloadAndSaveImage,
};
