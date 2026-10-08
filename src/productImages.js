'use strict';
const cheerio=require('cheerio');
const {canonicalProductUrl}=require('./catalogNormalization');

function imageUrl(value,base) {
  for(const item of [value || []].flat()) {
    const raw=typeof item==='string'?item:item?.contentUrl || item?.url;
    if(typeof raw!=='string' || !raw.trim() || /^(?:null|undefined)$/i.test(raw.trim()))continue;
    try {
      const url=new URL(raw.trim(),base);
      if(!['http:','https:'].includes(url.protocol) || url.username || url.password || /^(?:www\.)?(?:example\.(?:com|org|net)|localhost)$/i.test(url.hostname))continue;
      // Merchants commonly publish an HTTP image beside their HTTPS product.
      url.protocol='https:';url.hash='';return url.href;
    }catch{}
  }
  return null;
}
function sameImageProduct(a,b) {
  try {
    const left=new URL(canonicalProductUrl(new URL(a,b).href)),right=new URL(canonicalProductUrl(b));
    // Shopify handles identify the product. Size/roast selectors only select its
    // options. Other platforms retain identity-bearing queries (e.g. Imweb idx).
    if(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products\/[^/]+$/i.test(right.pathname)) {left.search='';right.search='';}
    return left.href===right.href;
  }catch{return false;}
}
function primaryProductImage({html='',url,sourceProduct,native}={}) {
  const selected=(value,source,name)=>{const image=imageUrl(value,url);return image?{url:image,evidence:{source,product_url:url,product_name:name || null}}:null;};
  let nativeBound=false;
  try {nativeBound=Boolean(native?.handle && decodeURIComponent(new URL(url).pathname.match(/\/products\/([^/]+)\/?$/)?.[1] || '')===native.handle);}catch{}
  const nativeImage=nativeBound?selected(native?.mainImage || native?.images?.map(i=>i.src || i),'native_primary_product',native?.title):null;
  if(nativeImage)return nativeImage;
  const sourceImage=selected(sourceProduct?.image,'adapter_primary_product',sourceProduct?.name);
  if(sourceImage)return sourceImage;
  const $=cheerio.load(html),nodes=[];
  $('script[type="application/ld+json"]').each((_,e)=>{try{const values=[JSON.parse($(e).text())].flat();for(const n of values){nodes.push(n,...[n?.['@graph'] || []].flat());if(n?.mainEntity)nodes.push(n.mainEntity);}}catch{}});
  const products=nodes.filter(n=>[n?.['@type']].flat().some(t=>['Product','ProductGroup','IndividualProduct'].includes(String(t).split('/').pop())));
  const exact=products.filter(p=>sameImageProduct(p.url || p['@id'],url) || !p.url && !p['@id'] && [p.offers || []].flat().length && [p.offers].flat().every(o=>sameImageProduct(o.url,url)));
  if(exact.length>1) {
    const images=exact.map(p=>imageUrl(p.image,url));
    if(!images.every(i=>i && i===images[0]))return {url:null,reason:'ambiguous_primary_product_images'};
  }
  if(exact.length) {
    const image=selected(exact[0].image,'product_jsonld',exact[0].name);
    if(image)return image;
  }
  const canonical=$('link[rel="canonical"]').attr('href'),ogUrl=$('meta[property="og:url"]').attr('content');
  const pageBound=[canonical,ogUrl].filter(Boolean).length && [canonical,ogUrl].filter(Boolean).every(v=>sameImageProduct(v,url));
  if(pageBound && $('meta[property="og:type"]').attr('content')==='product') {
    const type=$('meta[property="og:image:type"]').attr('content');
    if(type==='image/svg+xml')return {url:null,reason:'generated_svg_card_not_product_photo'};
    const image=selected($('meta[property="og:image:secure_url"]').attr('content') || $('meta[property="og:image"]').attr('content'),'product_open_graph',$('meta[property="og:title"]').attr('content'));
    if(image)return image;
  }
  return {url:null,reason:'primary_product_photo_missing'};
}
module.exports={imageUrl,sameImageProduct,primaryProductImage};
