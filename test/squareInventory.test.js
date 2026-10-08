'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const f=require('./fixtures/siteSupport/obscure-square.json');
const {discoverPublicSquareInventory,verifiedEmptyInventory}=require('../src/siteSupport/squareInventory');
const {discoverSquareProducts,apiBase}=require('../src/siteSupport/square');
const roaster={id:f.profile.entity_ids[0],website_url:'https://www.obscure.coffee'};
function response(data,url){return {success:true,status:200,finalUrl:url,data:JSON.stringify(data)};}
function empty(){return {data:[],meta:{pagination:{total:0,count:0,current_page:1,total_pages:1}}};}
function reader({context=f.context,categories=f.categories,catalog=f.catalog,referenceStatus=404,categoryItems=[]}={}) {
 const seen=[];
 const fetchHtml=async url=>{
  seen.push(url);const u=new URL(url);
  if(u.hostname==='www.obscure.coffee')return {success:true,status:200,finalUrl:url,data:context};
  if(u.pathname.endsWith('/categories'))return response(categories,url);
  if(/\/products\/[^/]+$/.test(u.pathname))return {success:false,status:referenceStatus,error:'HTTP '+referenceStatus};
  const id=u.searchParams.get('categories[]');
  if(id){const items=categoryItems.filter(p=>p.categoryIds.includes(id));return response(items.length?{data:items,meta:{pagination:{total:items.length,count:items.length,current_page:1,total_pages:1}}}:empty(),url);}
  return response(catalog,url);
 };
 return {fetchHtml,seen};
}
test('captured public Square inventory proves zero one-time coffees using all subscriptions, categories and 33 unavailable references',async()=>{
 const read=reader(),result=await discoverSquareProducts(roaster,f.profile,read.fetchHtml);
 assert.equal(result.complete,true);assert.deepEqual(result.urls,[]);assert(verifiedEmptyInventory(f.profile,result));
 assert.equal(result.inventory_authorizes_global_absence,false);assert.equal(result.empty_inventory_proof.reference_checks.length,33);
 assert.equal(result.empty_inventory_proof.published_subscriptions.length,2);
 assert(read.seen.some(url=>url.includes('/categories?')));assert(read.seen.every(url=>!url.includes('excluded_fulfillment')));
});
test('an omitted live reference or transient failure prevents an empty or successful inventory claim',async()=>{
 for(const referenceStatus of [200,429,503]){
  const result=await discoverPublicSquareInventory(roaster,f.profile,reader({referenceStatus}).fetchHtml);
  assert.equal(result.complete,false);assert(!verifiedEmptyInventory(f.profile,result));assert.match(result.error,/not accounted/);
 }
});
test('Square scope rejects wrong merchant, unknown category, missing native type, URL identity drift and truncated catalog',async()=>{
 const changes=[
  o=>o.context=o.context.replace('MLBNPWAMGBDSD','OTHER-MERCHANT'),
  o=>o.categories.data[0].name='Another category',
  o=>o.categories.data[0].preferred_order_product_ids.pop(),
  o=>delete o.catalog.data[0].only_subscribable,
  o=>o.catalog.data[0].merchant_id='OTHER-MERCHANT',
  o=>o.catalog.data[0].absolute_site_link='https://foreign.test/product/coffee/120',
  o=>o.catalog.data[0].site_product_id='different',
  o=>o.catalog.meta.pagination.total=3,
 ];
 for(const change of changes){const options=structuredClone({context:f.context,catalog:f.catalog,categories:f.categories});change(options);const result=await discoverPublicSquareInventory(roaster,f.profile,reader(options).fetchHtml);assert.equal(result.complete,false);assert(!verifiedEmptyInventory(f.profile,result));}
});
test('a newly published one-time coffee is discovered and no longer qualifies for empty handling',async()=>{
 const catalog=structuredClone(f.catalog),category=f.profile.coffee_category_ids[0],coffee={...catalog.data[0],id:'NEWCOFFEE',site_product_id:'200',name:'Ethiopia Coffee',only_subscribable:false,categoryIds:[category],absolute_site_link:'https://www.obscure.coffee/product/ethiopia-coffee/200'};
 catalog.data.push(coffee);catalog.meta.pagination.total=3;catalog.meta.pagination.count=3;
 const read=reader({catalog,categoryItems:[coffee]}),result=await discoverPublicSquareInventory(roaster,f.profile,read.fetchHtml);
 assert.equal(result.complete,true);assert.deepEqual(result.urls,[coffee.absolute_site_link]);assert(!verifiedEmptyInventory(f.profile,result));assert.equal(result.inventory_authorizes_global_absence,false);
 const disagree=await discoverPublicSquareInventory(roaster,f.profile,reader({catalog}).fetchHtml);assert.equal(disagree.complete,false);assert.match(disagree.error,/inventories disagree/);
});
test('empty handling cannot be enabled by a boolean, incomplete proof or permission to reconcile omissions',()=>{
 assert(verifiedEmptyInventory(f.profile,f.result));
 for(const change of [p=>delete p.empty_inventory_proof,p=>p.empty_inventory_proof.owner_id='other',p=>p.empty_inventory_proof.reference_checks.pop(),p=>p.empty_inventory_proof.reference_checks[0].status=503,p=>p.empty_inventory_proof.categories[0].coffee_items=1,p=>p.empty_inventory_proof.published_subscriptions=[]]){
  const result=structuredClone(f.result);change(result);assert(!verifiedEmptyInventory(f.profile,result));
 }
 assert(!verifiedEmptyInventory({...f.profile,inventory_authorizes_global_absence:true},f.result));
 assert(!verifiedEmptyInventory({...f.profile,reconcile_omissions:true},f.result));
 assert(!verifiedEmptyInventory({...f.profile,public_catalog_inventory:false},f.result));
});
