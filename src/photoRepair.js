'use strict';
const crypto=require('node:crypto');
const {primaryProductImage,sameImageProduct}=require('./productImages');
const {validateImage}=require('./sourceImage');
const {downloadAndSaveImage}=require('./imageDownloader');
function compatibleTitle(saved,current,roaster='') {
  const plain=value=>require('cheerio').load('<body>'+String(value || '')+'</body>')('body').text().normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
  const brand=plain(roaster).match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
  const words=value=>{
    let text=plain(value).replace(/^(?:seasonal|limited) release\s*\|\s*/i,'').replace(/\s*[-–—|:]\s*\d+(?:\.\d+)?\s*(?:g|kg|oz|lbs?)\s*$/i,'').replace(/\s*(?:[-–—|:]\s*)?(?:archived|subscriptions?|new harvest)\s*$/i,'').replace(/^\/\d+(?:\.\d+)?\s*/, '').match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
    if(brand && text.startsWith(brand+' '))text=text.slice(brand.length+1);
    return new Set(text.split(' ').filter(Boolean));
  };
  const left=words(saved),right=words(current);
  return left.size>0 && left.size===right.size && [...left].every(w=>right.has(w));
}
function hasPhoto(product) {return (product.product_media || []).some(m=>[m.media_assets].flat().some(a=>a?.url));}
async function inspectPhoto(product,{fetchPage,fetchImage}) {
  const base={product_id:product.id,entity_id:product.entity_id,name:product.name,source_url:product.source_url,prior_image_url:product.original_image_url || null};
  if(hasPhoto(product))return {...base,status:'already_has_photo'};
  if(!product.source_url)return {...base,status:'held',reason:'product_source_url_missing'};
  const page=await fetchPage(product.source_url);
  if(!page.success)return {...base,status:'held',reason:page.error || 'product_fetch_failed',http_status:page.status};
  if(!sameImageProduct(page.finalUrl || product.source_url,product.source_url))return {...base,status:'held',reason:'product_redirect_requires_identity_review',final_url:page.finalUrl};
  const finalUrl=page.finalUrl || product.source_url;
  const sourceProduct=page.sourceProduct || require('./productEvidence').structuredProduct(page.data,finalUrl);
  const image=primaryProductImage({html:page.data,url:finalUrl,sourceProduct});
  if(!image.url)return {...base,status:'held',reason:image.reason};
  const alias=require('../data/coffee-photo-title-aliases.json').find(a=>a.product_id===product.id && a.entity_id===product.entity_id && a.source_url===product.source_url && a.stored_title===product.name && a.current_title===image.evidence.product_name && (!a.native_product_id || String(sourceProduct?.productID || '')===a.native_product_id));
  if(!compatibleTitle(product.name,image.evidence.product_name,product.roaster) && !alias)return {...base,status:'held',reason:'current_product_title_requires_review',current_name:image.evidence.product_name,image_url:image.url};
  if(alias)image.evidence.reviewed_title_alias=alias.reason;
  const result=await fetchImage(image.url,{referer:page.finalUrl || product.source_url});
  if(!result.success)return {...base,status:'held',reason:result.error,image_url:image.url};
  const buffer=Buffer.from(result.data),format=await validateImage(buffer);
  if(!format)return {...base,status:'held',reason:'invalid_image_body',image_url:image.url};
  return {...base,status:'ready',image_url:image.url,image_evidence:image.evidence,content_hash:crypto.createHash('md5').update(buffer).digest('hex'),content_type:format.contentType,width:format.width,height:format.height,bytes:buffer.length};
}
async function applyPhoto(entry,{db,fetchPage,fetchImage,log}) {
  if(entry.status!=='ready')throw Error('Only verified ready photos can be applied');
  if(!Object.hasOwn(entry,'prior_image_url'))throw Error('Photo plan must include the reviewed prior source image URL');
  const {data:current,error}=await db.from('products').select('id,entity_id,name,source_url,original_image_url,product_media(media_assets(url))').eq('id',entry.product_id).single();
  if(error)throw error;
  if(!current || current.entity_id!==entry.entity_id || current.source_url!==entry.source_url)throw Error('Product identity changed since photo preview');
  if(hasPhoto(current)) {
    if(current.original_image_url!==entry.image_url && (!current.original_image_url || current.original_image_url===entry.prior_image_url)) {
      const {data:assets,error:assetError}=await db.from('media_assets').select('id').eq('content_hash',entry.content_hash);
      if(assetError)throw assetError;
      const {data:links,error:linkError}=await db.from('product_media').select('media_asset_id').eq('product_id',entry.product_id);
      if(linkError)throw linkError;
      if(links?.some(link=>assets?.some(asset=>asset.id===link.media_asset_id))) {
        const {error:saveError}=await db.from('products').update({original_image_url:entry.image_url}).eq('id',entry.product_id);
        if(saveError)throw saveError;
        return {product_id:entry.product_id,status:'source_url_repaired'};
      }
    }
    return {product_id:entry.product_id,status:'already_has_photo'};
  }
  let verifiedImage;
  const fresh=await inspectPhoto({...current,roaster:entry.roaster},{fetchPage,fetchImage:async(...args)=>{verifiedImage=await fetchImage(...args);return verifiedImage;}});
  if(fresh.status!=='ready' || fresh.image_url!==entry.image_url || fresh.content_hash!==entry.content_hash)throw Error('Primary product photo changed since preview');
  // Check again after merchant reads, so a concurrent crawl's photo is preserved.
  const {data:links,error:linkError}=await db.from('product_media').select('product_id').eq('product_id',entry.product_id);
  if(linkError)throw linkError;
  if(links?.length)return {product_id:entry.product_id,status:'already_has_photo'};
  const asset=await downloadAndSaveImage(entry.product_id,entry.image_url,log,{db,sourceUrl:entry.source_url,verifyFresh:true,fetchImage:async()=>verifiedImage});
  if(!asset)throw Error('Photo upload or linkage failed');
  const {error:saveError}=await db.from('products').update({original_image_url:entry.image_url}).eq('id',entry.product_id);
  if(saveError)throw saveError;
  return {product_id:entry.product_id,status:'repaired',media_asset_id:asset};
}
module.exports={hasPhoto,inspectPhoto,applyPhoto,compatibleTitle};
