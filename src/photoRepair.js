'use strict';
const crypto=require('node:crypto');
const {primaryProductImage}=require('./productImages');
const {imageFormat}=require('./sourceImage');
const {downloadAndSaveImage}=require('./imageDownloader');
function compatibleTitle(saved,current) {
  const words=value=>new Set(require('cheerio').load('<body>'+String(value || '')+'</body>')('body').text().normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const left=words(saved),right=words(current);
  return left.size>0 && right.size>0 && ([...left].every(w=>right.has(w)) || [...right].every(w=>left.has(w)));
}
function hasPhoto(product) {return (product.product_media || []).some(m=>[m.media_assets].flat().some(a=>a?.url));}
async function inspectPhoto(product,{fetchPage,fetchImage}) {
  const base={product_id:product.id,entity_id:product.entity_id,name:product.name,source_url:product.source_url};
  if(hasPhoto(product))return {...base,status:'already_has_photo'};
  if(!product.source_url)return {...base,status:'held',reason:'product_source_url_missing'};
  const page=await fetchPage(product.source_url);
  if(!page.success)return {...base,status:'held',reason:page.error || 'product_fetch_failed',http_status:page.status};
  const image=primaryProductImage({html:page.data,url:page.finalUrl || product.source_url});
  if(!image.url)return {...base,status:'held',reason:image.reason};
  if(!compatibleTitle(product.name,image.evidence.product_name))return {...base,status:'held',reason:'current_product_title_requires_review',current_name:image.evidence.product_name,image_url:image.url};
  const result=await fetchImage(image.url,{referer:page.finalUrl || product.source_url});
  if(!result.success)return {...base,status:'held',reason:result.error,image_url:image.url};
  const buffer=Buffer.from(result.data),format=imageFormat(buffer);
  if(!format)return {...base,status:'held',reason:'invalid_image_body',image_url:image.url};
  return {...base,status:'ready',image_url:image.url,image_evidence:image.evidence,content_hash:crypto.createHash('md5').update(buffer).digest('hex'),content_type:format.contentType,bytes:buffer.length};
}
async function applyPhoto(entry,{db,fetchPage,fetchImage,log}) {
  if(entry.status!=='ready')throw Error('Only verified ready photos can be applied');
  const {data:current,error}=await db.from('products').select('id,entity_id,name,source_url,product_media(media_assets(url))').eq('id',entry.product_id).single();
  if(error)throw error;
  if(!current || current.entity_id!==entry.entity_id || current.source_url!==entry.source_url)throw Error('Product identity changed since photo preview');
  if(hasPhoto(current))return {product_id:entry.product_id,status:'already_has_photo'};
  let verifiedImage;
  const fresh=await inspectPhoto(current,{fetchPage,fetchImage:async(...args)=>{verifiedImage=await fetchImage(...args);return verifiedImage;}});
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
