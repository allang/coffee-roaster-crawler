const { getSupabase } = require('./supabase');
const globalLogger = require('./logger');
const crypto = require('crypto');
const { fetchImage } = require('./httpClient');

const BUCKET_NAME = 'assets';

async function downloadAndSaveImage(productId, imageUrl, log = null) {
  const logger = log || globalLogger;
  
  if (!imageUrl) {
    return null;
  }

  let normalizedUrl = imageUrl;
  if (imageUrl.startsWith('//')) {
    normalizedUrl = 'https:' + imageUrl;
  }

  const supabase = getSupabase();

  try {
    const result = await fetchImage(normalizedUrl, {
      timeout: 30000,
      referer: normalizedUrl,
    });

    if (!result.success) {
      logger.warn('ImageDownloader', `Failed to download image: ${result.error}`, { url: normalizedUrl.substring(0, 100) });
      return null;
    }

    const buffer = Buffer.from(result.data);
    const contentHash = crypto.createHash('md5').update(buffer).digest('hex');

    const contentType = result.headers['content-type'] || 'image/jpeg';
    const ext = getExtensionFromContentType(contentType);
    const fileName = `products/${productId}/${contentHash}${ext}`;

    const { data: existingAsset } = await supabase
      .from('media_assets')
      .select('id, url')
      .eq('content_hash', contentHash)
      .single();

    if (existingAsset) {
      await linkProductMedia(productId, existingAsset.id, logger);
      logger.info('ImageDownloader', `Reused existing asset: ${contentHash}`);
      return existingAsset.id;
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
      })
      .select('id')
      .single();

    if (insertError) {
      logger.error('ImageDownloader', 'Failed to create media_asset', { error: insertError.message });
      return null;
    }

    await linkProductMedia(productId, mediaAsset.id, logger);
    logger.success('ImageDownloader', `Saved image: ${fileName}`);
    return mediaAsset.id;

  } catch (error) {
    logger.warn('ImageDownloader', `Failed to download image: ${error.message}`, { url: normalizedUrl.substring(0, 100) });
    return null;
  }
}

async function linkProductMedia(productId, mediaAssetId, logger) {
  const supabase = getSupabase();

  const { data: existingLink } = await supabase
    .from('product_media')
    .select('product_id')
    .eq('product_id', productId)
    .eq('media_asset_id', mediaAssetId)
    .single();

  if (existingLink) {
    return true;
  }

  const { error } = await supabase
    .from('product_media')
    .insert({
      product_id: productId,
      media_asset_id: mediaAssetId,
      sort_order: 0,
    });

  if (error) {
    logger.warn('ImageDownloader', 'Failed to link product_media', { error: error.message });
    return false;
  }
  
  return true;
}

function getExtensionFromContentType(contentType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
  };
  return map[contentType] || '.jpg';
}

module.exports = {
  downloadAndSaveImage,
};
