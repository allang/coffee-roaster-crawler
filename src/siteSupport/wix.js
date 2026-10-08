'use strict';
const cheerio=require('cheerio');
const {parseWeightGrams}=require('../product-value-parsers.cjs');
const STORE_APP='1380b703-ce81-ff05-f115-39571d94dfcd';
const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function storeData(html) {
  const $=cheerio.load(html || ''),nodes=$('script#wix-warmup-data[type="application/json"]');
  if(nodes.length!==1)throw Error('Wix primary JSON missing/ambiguous');
  let data;try{data=JSON.parse(nodes.text());}catch{throw Error('Invalid Wix primary JSON');}
  const store=data.appsWarmupData?.[STORE_APP];
  if(!store || typeof store!=='object' || Array.isArray(store))throw Error('Wix store data missing');
  return store;
}
function descriptionText(value) {
  if(typeof value!=='string')return '';
  if(!value.trim().startsWith('{'))return value;
  let rich;try{rich=JSON.parse(value);}catch{throw Error('Invalid Wix rich description');}
  if(!Array.isArray(rich.nodes))throw Error('Wix rich description nodes missing');
  let count=0;
  function nodeText(node,depth=0){if(depth>40 || ++count>10000)throw Error('Wix description limit');return (typeof node.textData?.text==='string'?node.textData.text:'')+(Array.isArray(node.nodes)?node.nodes.map(n=>nodeText(n,depth+1)).join(''):'');}
  return rich.nodes.map(node=>nodeText(node)).join('\n');
}
async function discoverWixProducts(roaster,profile,fetchHtml) {
  const urls=new Set(),evidence=[];
  try {
    for(const path of profile.listing_paths){
      const listing=new URL(path,roaster.website_url).href,response=await fetchHtml(listing);
      if(!response.success)throw Error(response.error || 'Wix listing fetch failed');
      const base=new URL(response.finalUrl || listing);if(!profile.hosts.includes(base.hostname))throw Error('Wix listing owner mismatch');
      const catalog=storeData(response.data)[profile.wix_listing_key]?.catalog,category=catalog?.category,products=category?.productsWithMetaData;
      if(catalog?.isCatalogV3!==true || category?.id!==profile.wix_coffee_category_id || !Array.isArray(products?.list) || !Number.isSafeInteger(products.totalCount) || products.totalCount!==products.list.length || !products.totalCount)throw Error('Wix current shop category incomplete');
      const ids=new Set();
      for(const product of products.list){if(!uuid(product.id) || ids.has(product.id) || product.isVisible===false || product.productType!=='physical' || typeof product.urlPart!=='string' || /[/?#]/.test(product.urlPart) || !product.urlPart)throw Error('Wix shop product identity invalid/repeated');ids.add(product.id);urls.add(new URL(profile.product_path+product.urlPart,base).href);}
      evidence.push({listing,category_id:category.id,category_name:category.name,products:products.list.length,total:products.totalCount});
    }
    return {supported:true,urls:[...urls],complete:true,evidence};
  }catch(error){return {supported:true,urls:[...urls],complete:false,error:error.message,evidence};}
}
function wixProduct(html,url,profile) {
  const parsed=new URL(url),handle=decodeURIComponent(parsed.pathname.slice(profile.product_path.length)),store=storeData(html);
  const records=Object.entries(store).filter(([key,value])=>key.startsWith('productPage_') && value?.catalog?.product);
  if(records.length!==1)throw Error('Wix primary product missing/ambiguous');
  const product=records[0][1].catalog.product;
  if(!profile.hosts.includes(parsed.hostname) || !parsed.pathname.startsWith(profile.product_path) || product.urlPart!==handle || !uuid(product.id) || product.isVisible!==true || product.productType!=='physical' || !product.categoryIds?.includes(profile.wix_coffee_category_id))throw Error('Wix primary current coffee mismatch');
  if(!/^[A-Z]{3}$/.test(product.currency || '') || !Array.isArray(product.productItems) || !product.productItems.length || typeof product.isManageProductItems!=='boolean')throw Error('Wix exact variants/currency missing');
  const selections=new Map(),netSizes=new Map();
  for(const option of product.options || [])for(const selection of option.selections || []){if(!Number.isInteger(selection.id) || selections.has(selection.id) || typeof selection.value!=='string')throw Error('Wix option identity ambiguous');selections.set(selection.id,selection.value);if(/^(?:poids|weight|size)$/i.test(option.title || ''))netSizes.set(selection.id,parseWeightGrams(selection.value));}
  const ids=new Set(),offers=[];
  for(const variant of product.productItems){
    if(!uuid(variant.id) || ids.has(variant.id) || typeof variant.price!=='number' || !Number.isFinite(variant.price) || variant.price<0 || variant.automaticDiscount || !Array.isArray(variant.optionsSelections) || variant.optionsSelections.some(id=>!selections.has(id)))throw Error('Wix exact variant identity/price mismatch');ids.add(variant.id);
    const status=variant.inventory?.status,preOrder=variant.availableForPreOrder===true;
    if(!['in_stock','out_of_stock'].includes(status) || typeof variant.availableForPreOrder!=='boolean')throw Error('Wix exact variant stock missing');
    const sizes=variant.optionsSelections.map(id=>netSizes.get(id)).filter(v=>v!=null),explicitTitleSize=product.name?.match(/(?:^| - )((?:\d+(?:[.,]\d+)?)\s*(?:g|kg))\s*$/i)?.[1];
    const netWeight=sizes.length===1?sizes[0]:!product.isManageProductItems && !sizes.length?parseWeightGrams(explicitTitleSize):null;
    offers.push({'@type':'Offer','@id':variant.id,url:parsed.href,name:variant.optionsSelections.map(id=>selections.get(id)).join(' / ') || product.name,price:String(variant.price),priceCurrency:product.currency,availability:status==='in_stock'?'https://schema.org/InStock':preOrder?'https://schema.org/PreOrder':'https://schema.org/OutOfStock',_net_weight_g:netWeight,_stock_evidence:{merchant_status:status,available_for_preorder:preOrder,quantity:variant.inventory?.quantity ?? null}});
  }
  if(product.isManageProductItems===false && (offers.length!==1 || product.productItems[0].optionsSelections.length))throw Error('Wix unmanaged variant ambiguity');
  const combinations=(product.options || []).reduce((n,o)=>n*(o.selections?.length || 0),1);
  const variantsComplete=!product.isManageProductItems || combinations===offers.length && new Set(product.productItems.map(v=>JSON.stringify([...v.optionsSelections].sort()))).size===offers.length && product.productItems.every(v=>(product.options || []).every(o=>v.optionsSelections.filter(id=>o.selections.some(s=>s.id===id)).length===1));
  return {'@type':'Product',url:parsed.href,productID:product.id,name:product.name,description:descriptionText(product.description),image:product.media?.[0]?.fullUrl || product.media?.[0]?.url,category:'Coffee',offers,_variants_complete:variantsComplete,_market_source:'wix_primary_exact_variant'};
}
module.exports={storeData,discoverWixProducts,wixProduct};
