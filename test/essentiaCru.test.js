'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cheerio=require('cheerio');
const fs=require('node:fs'),vm=require('node:vm');
const profiles=require('../src/siteSupport/profiles.json');
const {profileFor}=require('../src/siteSupport/discovery');
const {discoverDomProducts}=require('../src/siteSupport/domDiscovery');
const {nativeJson,primaryProduct,fetchCafe24OptionProduct}=require('../src/siteSupport/cafe24Options');
const {discoverSquareProducts,fetchSquareProduct}=require('../src/siteSupport/square');
const {normalizeProduct}=require('../src/catalogNormalization'),{structuredExtraction}=require('../src/extraction');
const {productAvailability}=require('../src/productEvidence');
const fixture=require('./fixtures/siteSupport/essentia-cafe24.json'),square=require('./fixtures/siteSupport/cru-square.json');
const essentia=profiles.find(p=>p.name==='Essentia Factory'),cru=profiles.find(p=>p.name==='CRU Coffee Hakuraku');
const page=id=>fixture.products.find(p=>p.id===id),readListing=async url=>({success:true,status:200,finalUrl:url,data:fixture.listings.find(p=>p.url===url)?.html || ''});
function mutateStock(record,change) {
 const $=cheerio.load(record.html),script=$('script').last(),text=script.text(),match=text.match(/\bvar\s+option_stock_data\s*=\s*'([^'\r\n]*)'\s*;/),data=nativeJson(match[1]);
 change(data);const raw=JSON.stringify(JSON.stringify(data)).slice(1,-1);script.text(text.replace(match[0],"var option_stock_data = '"+raw+"';"));return $.html();
}
test('Essentia and CRU registration is exact-owner only and omission reconciliation stays disabled',()=>{
 for(const p of [essentia,cru]){assert.equal(profileFor({id:p.entity_ids[0],website_url:p.bootstrap_url}),p);assert.equal(profileFor({id:'another-owner',website_url:p.bootstrap_url}),null);assert.equal(p.reconcile_omissions,false);assert.equal(p.inventory_authorizes_global_absence,false);}
});
test('Essentia follows all six published pages beyond the five-number window and excludes consultation',async()=>{
 const urls=[],result=await discoverDomProducts({website_url:essentia.bootstrap_url},essentia,async url=>{urls.push(url);return readListing(url);});
 assert.equal(result.complete,true);assert.equal(urls.length,6);assert.equal(result.urls.length,84);assert(!result.urls.some(u=>u.endsWith('=271')));assert(urls.every(u=>new URL(u).searchParams.get('cate_no')==='56'));
 assert.equal(new URL(urls.at(-1)).searchParams.get('page'),'6');
 const legacy=await discoverDomProducts({website_url:essentia.bootstrap_url},{...essentia,pagination_next_selector:undefined},readListing);
 assert.equal(legacy.evidence.length,5);assert.equal(legacy.urls.length,79);
});
test('Essentia missing, contradictory or foreign next-page controls fail before following them',async()=>{
 for(const mode of ['missing','foreign','category','skip']){
  const urls=[],result=await discoverDomProducts({website_url:essentia.bootstrap_url},essentia,async url=>{
   urls.push(url);const response=await readListing(url),$=cheerio.load(response.data),next=$(essentia.pagination_next_selector);
   if(mode==='missing')next.remove();else next.attr('href',mode==='foreign'?'https://foreign.example/product/list.html?cate_no=56&page=2':mode==='category'?'?cate_no=57&page=2':'?cate_no=56&page=3');
   return {...response,data:$.html()};
  });assert.equal(result.complete,false);assert.match(result.error,/next-page/);assert.equal(urls.length,1);
 }
});
test('Essentia exact native SKUs retain 200g/500g/1kg and KRW prices rather than price deltas',()=>{
 const record=page('39'),source=primaryProduct(record.html,record.url,essentia),p=normalizeProduct(structuredExtraction({html:record.html,url:record.url,sourceProduct:source},null).product,record.url);
 assert.equal(p.variants.length,15);assert.equal(p.variants_complete,true);assert.equal(p.source_product_id,'39');
 assert.deepEqual(p.variants.map(v=>v.money.minorUnits),[...Array(5).fill(8900),...Array(5).fill(27900),...Array(5).fill(16800)]);
 assert.deepEqual(p.variants.map(v=>v.weight_g),[...Array(5).fill(200),...Array(5).fill(1000),...Array(5).fill(500)]);
 assert(p.variants.every(v=>v.money.currency==='KRW' && v.availability==='in_stock'));assert.equal(p.variants[0].source_id,'P00000BN000A');
});
test('Essentia combined SKU selectors and both 180-SKU bundles bind only enumerated native combinations',()=>{
 const combined=primaryProduct(page('45').html,page('45').url,essentia);assert.equal(combined.offers.length,15);assert.equal(combined.offers[0]['@id'],'P00000BT000A');assert.equal(combined.offers[0]._net_weight_g,200);
 for(const [id,weight]of [['76',1000],['77',400]]){const record=page(id),source=primaryProduct(record.html,record.url,essentia);assert.equal(source.offers.length,180);assert(source.offers.every(o=>o._net_weight_g===weight));assert.equal(new Set(source.offers.map(o=>o['@id'])).size,180);}
 const record=page('77'),source=primaryProduct(record.html,record.url,essentia),missing=source.offers.find(o=>o._stock_evidence.stock_number===null);
 assert(missing);assert.equal(missing._stock_evidence.inventory_managed,false);assert.equal(missing.availability,'https://schema.org/InStock');
 for(const [id,weight]of [['132',340],['145',60],['146',60],['309',100]]){const record=page(id),source=primaryProduct(record.html,record.url,essentia);assert(source.offers.every(o=>o._net_weight_g===weight));}
 const collection=page('145');assert.throws(()=>primaryProduct(collection.html.replaceAll('20g x 3','20g x 4'),collection.url,essentia),/contents/);
});
test('Essentia missing or repeated native combinations, wrong identities and altered money fail closed',()=>{
 const record=page('39');
 for(const change of [d=>delete d[Object.keys(d)[0]],d=>{const keys=Object.keys(d);d[keys[1]].option_value_orginal=d[keys[0]].option_value_orginal;d[keys[1]].option_value=d[keys[0]].option_value;},d=>d[Object.keys(d)[0]].option_price++,d=>d[Object.keys(d)[0]].option_id='ZZZZ'])assert.throws(()=>primaryProduct(mutateStock(record,change),record.url,essentia),/matrix|duplicate|price|identity/);
 for(const html of [record.html.replace('property="product:productId" content="39"','property="product:productId" content="40"'),record.html.replace('alt="P00000BN"','alt="P00000BX"'),record.html.replace(/content="KRW"/g,'content="USD"')])assert.throws(()=>primaryProduct(html,record.url,essentia),/identity|code|price|currency/);
 assert.throws(()=>primaryProduct(record.html,record.url.replace('https:','http:'),essentia),/identity/);
});
test('Essentia stock handling distinguishes untracked zero/missing quantities from tracked stock and sold-out controls',()=>{
 for(const [id,state]of [['141','in_stock'],['145','sold_out']]){const record=page(id),source=primaryProduct(record.html,record.url,essentia);assert.equal(productAvailability({sourceProduct:source,sourceUrl:record.url}).state,state);}
 const record=page('39');
 const missing=mutateStock(record,d=>{const row=d[Object.keys(d)[0]];row.use_stock=true;row.use_stock_original='T';delete row.stock_number;});assert.throws(()=>primaryProduct(missing,record.url,essentia),/stock contract/);
 const empty=mutateStock(record,d=>{const row=d[Object.keys(d)[0]];row.use_stock=true;row.use_stock_original='T';row.stock_number=0;});assert.throws(()=>primaryProduct(empty,record.url,essentia),/empty tracked/);
 const sold=mutateStock(record,d=>{const row=d[Object.keys(d)[0]];row.use_stock=true;row.use_stock_original='T';row.stock_number=0;row.use_soldout='T';row.use_soldout_original='T';});assert.equal(primaryProduct(sold,record.url,essentia).offers[0].availability,'https://schema.org/OutOfStock');
 const $=cheerio.load(record.html);$('#btnBuy').addClass('displaynone');assert.throws(()=>primaryProduct($.html(),record.url,essentia),/purchase\/stock/);
});
test('Essentia parses JSON data without executing scripts and verifies primary photo ownership',()=>{
 const record=page('39');globalThis.essentiaScriptRan=false;
 const source=primaryProduct(record.html+'<script>globalThis.essentiaScriptRan=true</script>',record.url,essentia);assert.equal(globalThis.essentiaScriptRan,false);delete globalThis.essentiaScriptRan;
 assert(source._description_image_urls.length);assert(source._description_image_urls.every(u=>new URL(u).hostname==='essentiafactory.com'));
 assert.throws(()=>nativeJson('({run:process.exit()})'),/JSON/);
 const $=cheerio.load(record.html);$('meta[property="og:image"]').attr('content','https://foreign.example/photo.jpg');assert.throws(()=>primaryProduct($.html(),record.url,essentia),/image mismatch/);
});
test('Essentia category proof is shared within one reader but not another or an incomplete reader',async()=>{
 let calls=0;const read=async url=>{calls++;return readListing(url);};
 for(const id of ['39','45']){const record=page(id);await fetchCafe24OptionProduct(record.html,record.url,essentia,read);}assert.equal(calls,6);
 const record=page('39');await assert.rejects(fetchCafe24OptionProduct(record.html,record.url,essentia,async url=>url.endsWith('page=6')?{success:false,error:'HTTP 503'}:readListing(url)),/membership incomplete/);
});
test('normal page visitor uses the same scoped Essentia reader and native SKU proof',async()=>{
 const record=page('39'),{fetchPageContent}=require('../src/pageVisitor');
 const result=await fetchPageContent(record.url,null,{siteProfile:essentia,fetchHtml:async url=>url===record.url?{success:true,status:200,finalUrl:url,data:record.html}:readListing(url)});
 assert.equal(result.success,true);assert.equal(result.sourceProduct.offers.length,15);assert.equal(result.sourceProduct._variants_complete,true);
});
const squareHtml='<script>window.__BOOTSTRAP_STATE__ = '+JSON.stringify(square.bootstrap)+';</script>';
function squareReader(product=square.product,skus=square.skus) {
 return async url=>{const u=new URL(url);return {success:true,status:200,finalUrl:url,data:JSON.stringify(u.pathname.endsWith('/skus')?{data:skus,meta:{pagination:{total_pages:1,current_page:1,total:skus.length}}}:{data:product})};};
}
test('CRU uses the exact native JPY SKU amount, not the product aggregate low, and a reviewed single-SKU bag title',async()=>{
 const url=square.product.absolute_site_link,source=await fetchSquareProduct(squareHtml,url,cru,squareReader()),p=normalizeProduct(structuredExtraction({html:squareHtml,url,sourceProduct:source},null).product,url);
 assert.equal(square.product.price.low,1500);assert.equal(p.variants[0].money.minorUnits,2000);assert.equal(p.variants[0].money.currency,'JPY');assert.equal(p.variants[0].weight_g,150);assert.equal(p.variants[0].source_id,square.skus[0].id);assert.equal(p.variants[0].availability,'in_stock');
 const legacy=await fetchSquareProduct(squareHtml,url,{...cru,square_single_sku_title_weight:false},squareReader());assert.equal(legacy.offers[0]._net_weight_g,null);
 const wrong=structuredClone(square.skus);wrong[0].name='300g';await assert.rejects(fetchSquareProduct(squareHtml,url,cru,squareReader(square.product,wrong)),/weights disagree/);
});
test('CRU discovers the 11 published coffee products with stable exact IDs and excludes wrong owners',async()=>{
 const read=async url=>url===cru.bootstrap_url?{success:true,data:squareHtml}:({success:true,data:JSON.stringify({data:square.products,meta:{pagination:{total_pages:1,current_page:1,total:11}}})});
 const result=await discoverSquareProducts({website_url:cru.bootstrap_url},cru,read);assert.equal(result.complete,true);assert.equal(result.urls.length,11);
 const bad=structuredClone(square.products);bad[0].owner_id='another-owner';assert.equal((await discoverSquareProducts({website_url:cru.bootstrap_url},cru,async url=>url===cru.bootstrap_url?read(url):{success:true,data:JSON.stringify({data:bad,meta:{pagination:{total_pages:1,current_page:1,total:11}}})})).complete,false);
});
test('CLI keeps the existing Squarespace fetch callback and routes only the opt-in Cafe24 branch',async()=>{
 for(const adapter of ['squarespace','cafe24']){
  const profile={name:'CLI test',adapter,hosts:['store.example'],entity_ids:['owner'],cafe24_native_option_items:adapter==='cafe24'},url='https://store.example/product/detail.html?product_no=39',read=async()=>({success:true,status:200,data:'fixture',finalUrl:url});let invoked=0;
  const source={sentinel:adapter},fakeProduct={source_product_id:'39',name:'Coffee',variants_complete:true,variants:[{source_id:'sku',title:'200g',money:{currency:'KRW',minorUnits:8900},availability:'in_stock'}]};
  const modules={'node:fs':{},'./profiles.json':[profile],'./discovery':{discoverProfileProducts:async()=>({complete:true,urls:[url]})},'./network':{createReader:()=>({fetchHtml:read,requests:[]})},'../extraction':{structuredExtraction:page=>{assert.equal(page.sourceProduct,source);return {coffee:true,product:source};}},'../catalogNormalization':{normalizeProduct:()=>fakeProduct},'../productEvidence':{productAvailability:()=>({state:'in_stock',variants:[]}),productOnlyOffer:()=>null},'../shopifyProduct':{},'./txt':{partialScopeAllowed:()=>false},'./squareInventory':{verifiedEmptyInventory:()=>false},['./'+(adapter==='squarespace'?'squarespace':'cafe24Options')]:{[adapter==='squarespace'?'fetchSquarespaceProduct':'fetchCafe24OptionProduct']:async(html,u,p,fetch)=>{assert.equal(fetch,read);invoked++;return source;}}};
  const sandbox={require:name=>{assert(Object.hasOwn(modules,name),name);return modules[name];},module:{exports:{}},process:{argv:['node','cli','CLI test']},console:{log:()=>{}},URL,Date,Set};vm.runInNewContext(fs.readFileSync(require.resolve('../src/siteSupport/cli'),'utf8'),sandbox);await sandbox.module.exports.main();assert.equal(invoked,1);assert.equal(sandbox.process.exitCode,undefined);
 }
});
