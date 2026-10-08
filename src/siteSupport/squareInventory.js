'use strict';
const policy='square_subscription_only_public_inventory';
function verifiedEmptyInventory(profile,result) {
  const p=result?.empty_inventory_proof;
  if(profile?.adapter!=='square' || profile.public_catalog_inventory!==true || profile.reconcile_omissions!==false || profile.inventory_authorizes_global_absence!==false || !result?.supported || result.complete!==true || result.urls?.length!==0 || result.inventory_authorizes_global_absence!==false || p?.kind!==policy || p.owner_id!==profile.square_owner_id || p.site_id!==profile.square_site_id || p.merchant_id!==profile.square_merchant_id)return false;
  if(!Array.isArray(p.published_subscriptions) || !p.published_subscriptions.length || new Set(p.published_subscriptions.map(r=>r.id)).size!==p.published_subscriptions.length || new Set(p.published_subscriptions.map(r=>r.site_product_id)).size!==p.published_subscriptions.length || p.published_subscriptions.some(r=>typeof r.id!=='string' || !/^[a-z0-9]+$/i.test(r.id) || typeof r.site_product_id!=='string' || !/^[a-z0-9]+$/i.test(r.site_product_id)))return false;
  if(!Array.isArray(p.categories) || p.categories.length!==profile.coffee_category_ids?.length || new Set(p.categories.map(r=>r.id)).size!==p.categories.length || p.categories.some(r=>!profile.coffee_category_ids.includes(r.id) || r.coffee_items!==0 || !Array.isArray(r.reference_ids) || r.reference_ids.some(id=>typeof id!=='string' || !/^[a-z0-9]+$/i.test(id))))return false;
  const ids=new Set(p.categories.flatMap(r=>r.reference_ids));
  if(!Array.isArray(p.reference_checks) || p.reference_checks.length!==ids.size || new Set(p.reference_checks.map(r=>r.id)).size!==ids.size)return false;
  return p.reference_checks.every(r=>ids.has(r.id) && ([404,410].includes(r.status) || r.status==='excluded_subscription' && p.published_subscriptions.some(s=>s.id===r.id || s.site_product_id===r.id)));
}
function publicProduct(item,merchant,profile) {
  if(item.owner_id!==profile.square_owner_id || item.merchant_id!==merchant.merchant_id || typeof item.only_subscribable!=='boolean' || !Array.isArray(item.categoryIds) || typeof item.name!=='string' || !item.name.trim())throw Error('Square public product identity/type mismatch');
  const url=new URL(item.absolute_site_link),id=url.pathname.match(/^\/product\/[^/]+\/([a-z0-9]+)\/?$/i)?.[1];
  if(url.protocol!=='https:' || url.username || url.password || url.port || !profile.hosts.includes(url.hostname) || url.hostname===new URL(profile.catalog_origin).hostname || url.search || url.hash || !id || id!==String(item.site_product_id))throw Error('Square public product canonical identity mismatch');
  return url.href;
}
async function discoverPublicSquareInventory(roaster,profile,fetchHtml) {
  const {context,apiBase,paged}=require('./square'),evidence=[];
  try {
    const home=await fetchHtml(roaster.website_url);if(!home.success)throw Error('Square homepage unavailable');
    const merchant=context(home.data,profile),base=apiBase(profile);
    if(merchant.merchant_id!==profile.square_merchant_id)throw Error('Square public merchant changed');
    const categories=await paged(base+'/categories',fetchHtml);
    if(categories.length!==profile.coffee_categories.length || categories.some(c=>!profile.coffee_categories.some(e=>e.id===c.id && e.name===c.name && e.site_category_id===c.site_category_id && e.parent===c.parent) || c.published!==true || !Number.isInteger(c.product_count?.visible) || c.product_counts?.visible!==c.product_count.visible || !Array.isArray(c.preferred_order_product_ids) || c.preferred_order_product_ids.length!==c.product_count.visible || c.preferred_order_product_ids.some(id=>typeof id!=='string' || !/^[a-z0-9]+$/i.test(id)) || new Set(c.preferred_order_product_ids).size!==c.preferred_order_product_ids.length))throw Error('Square reviewed public category contract changed');
    const all=await paged(base+'/products?include=images,media_files,discounts',fetchHtml),visible=all.filter(p=>p.visibility==='visible'),urls=new Set(),subscriptions=[];
    if(new Set(visible.map(p=>String(p.site_product_id))).size!==visible.length)throw Error('Square public canonical identity repeated');
    const byReference=new Map();
    for(const item of visible) {
      const url=publicProduct(item,merchant,profile);byReference.set(item.id,item);byReference.set(String(item.site_product_id),item);
      if(item.only_subscribable){subscriptions.push({id:item.id,site_product_id:String(item.site_product_id)});continue;}
      if(!item.categoryIds.some(id=>profile.coffee_category_ids.includes(id)))throw Error('Square public product is outside the reviewed coffee taxonomy');
      if(!profile.exclude_product_ids?.includes(item.id) && !require('./shopifyDiscovery').excluded.test(item.name))urls.add(url);
    }
    evidence.push({listing:base+'/products',catalog_items:all.length,published_items:visible.length,excluded_subscriptions:subscriptions.length,coffee_items:urls.size,fulfillment_filter_applied:false});
    const categoryEvidence=[],categoryCoffeeUrls=new Set();
    for(const category of categories) {
      const request=new URL(base+'/products');request.search=new URLSearchParams({'categories[]':category.id,include:'images,media_files,discounts'}).toString();
      const items=await paged(request.href,fetchHtml),allowedCategories=new Set([category.id,...categories.filter(c=>c.parent===category.id).map(c=>c.id)]);let coffees=0;
      for(const item of items.filter(p=>p.visibility==='visible')) {
        const url=publicProduct(item,merchant,profile);
        if(!item.categoryIds.some(id=>allowedCategories.has(id)) || !visible.some(p=>p.id===item.id && p.only_subscribable===item.only_subscribable && p.absolute_site_link===item.absolute_site_link))throw Error('Square category/global public inventories disagree');
        if(!item.only_subscribable && !profile.exclude_product_ids?.includes(item.id) && !require('./shopifyDiscovery').excluded.test(item.name)){coffees++;categoryCoffeeUrls.add(url);}
      }
      categoryEvidence.push({id:category.id,name:category.name,returned_items:items.length,coffee_items:coffees,metadata_visible_items:category.product_count.visible,reference_ids:category.preferred_order_product_ids});
    }
    if(categoryCoffeeUrls.size!==urls.size || [...urls].some(url=>!categoryCoffeeUrls.has(url)))throw Error('Square category/global coffee inventories disagree');
    evidence.push(...categoryEvidence);
    const references=[...new Set(categories.flatMap(c=>c.preferred_order_product_ids))],checks=[];
    if(references.length>500)throw Error('Square public reference inspection limit reached');
    for(const id of references) {
      if(byReference.has(id)){const item=byReference.get(id);checks.push({id,status:item.only_subscribable?'excluded_subscription':'published_coffee'});continue;}
      const response=await fetchHtml(base+'/products/'+id+'?include=images,options,category,fulfillment');
      if(![404,410].includes(response.status))throw Error('Square category reference is not accounted for by the public catalog: '+id+' ('+(response.error || response.status)+')');
      checks.push({id,status:response.status});
    }
    evidence.push({declared_reference_count:references.length,reference_checks:checks});
    const result={supported:true,urls:[...urls],complete:true,evidence,inventory_authorizes_global_absence:false,inventory_scope:'published_one_time_retail_coffee'};
    if(!urls.size) {
      result.empty_inventory_proof={kind:policy,owner_id:profile.square_owner_id,site_id:profile.square_site_id,merchant_id:merchant.merchant_id,published_subscriptions:subscriptions,categories:categoryEvidence,reference_checks:checks};
      if(!verifiedEmptyInventory(profile,result))throw Error('Square empty retail inventory is not proven by published subscriptions and all category references');
    }
    return result;
  }catch(error){return {supported:true,urls:[],complete:false,error:error.message,evidence,inventory_authorizes_global_absence:false};}
}
module.exports={discoverPublicSquareInventory,verifiedEmptyInventory};
