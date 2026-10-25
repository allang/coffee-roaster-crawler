'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectCapture}=require('../scripts/inspect-stores-browser-capture.cjs');
const fixture=require('./fixtures/siteSupport/aura-browser-source.json');
test('Aura browser capture proves four observed coffees and 29 native options without claiming HTTP or ingestion support',()=>{
 const report=inspectCapture(fixture);assert.equal(report.product_count,4);assert.equal(report.native_variant_count,29);assert.equal(report.automated_http_supported,false);assert.equal(report.production_ingest_verified,false);assert.equal(report.inventory_authorizes_global_absence,false);assert.equal(report.production_writes,0);assert.equal(report.ai_calls,0);
});
test('Aura source evidence keeps exact JPY options rather than copying an aggregate minimum to every SKU',()=>{
 const report=inspectCapture(fixture),blend=report.products.find(p=>p.source_product_id==='67a9967b7ae10400da93f5da');assert.deepEqual(blend.variants.map(v=>v.minor_units),[200,950,1650,3970,6550,15000,950,1650]);assert.equal(new Set(blend.variants.map(v=>v.id)).size,8);assert(blend.variants.every(v=>v.currency==='JPY'));
});
test('Aura sample net mass follows the exact 20g purchase label, not contradictory 30g prose',()=>{
 const blend=inspectCapture(fixture).products.find(p=>p.source_product_id==='67a9967b7ae10400da93f5da');assert.deepEqual(blend.variants.map(v=>v.weight_g),[20,100,200,500,1000,2500,100,200]);assert.match(fixture.products[0].schemas.flat().find(p=>p['@type']==='Product').description,/30g/);
});
test('Aura evidence rejects foreign merchants, wrong product identities and incomplete observed categories',()=>{
 for(const mutate of [r=>r.products[0].merchant_ids=['foreign'],r=>r.products[0].product_id='ffffffffffffffffffffffff',r=>r.products[0].title='Another product',r=>r.products[0].url='https://foreign.example/items/67a9967b7ae10400da93f5da',r=>r.category.links.pop(),r=>r.products.push(r.products[0])]){const r=structuredClone(fixture);mutate(r);assert.throws(()=>inspectCapture(r),/binding|identity|URL|set mismatch/);}
});
test('Aura evidence rejects mismatched currency, displayed price, disabled controls and cross-SKU bindings',()=>{
 for(const mutate of [r=>r.products[0].schemas[0][0].offers.priceCurrency='USD',r=>r.products[0].rows[0].prices='¥201',r=>r.products[0].rows[0].buttons[0].disabled='',r=>r.products[0].rows[0].buttons[0].binding=r.products[0].rows[1].buttons[0].binding,r=>r.products[0].schemas[0][0].offers.lowPrice=1]){const r=structuredClone(fixture);mutate(r);assert.throws(()=>inspectCapture(r),/market|price|stock|range disagreement/);}
});
test('Aura source inspection never executes the published native controller calls or extra scripts',()=>{
 const r=structuredClone(fixture);globalThis.storesScriptRan=false;r.products[0].native_init+='\nglobalThis.storesScriptRan=true;';assert.equal(inspectCapture(r).native_variant_count,29);assert.equal(globalThis.storesScriptRan,false);delete globalThis.storesScriptRan;
});
test('the browser evidence CLI is offline and explicitly reports no automated HTTP support',()=>{
 const {spawnSync}=require('node:child_process'),path=require('node:path'),result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/inspect-stores-browser-capture.cjs'),path.join(__dirname,'fixtures/siteSupport/aura-browser-source.json')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{products:4,native_variants:29,automated_http_supported:false,production_writes:0});
});
