'use strict';
const fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),{performance}=require('node:perf_hooks');
const {catalogPayload}=require('../src/productSaver');
const {productAvailability}=require('../src/productEvidence');
const BASE='98f5aeaceea95016f0d5f7a1131ad71867d5c3c2';
const log=new Proxy({},{get:()=>()=>{}});
function oldModule(file,dependencies){const module={exports:{}};vm.runInNewContext(execFileSync('git',['show',`${BASE}:${file}`],{encoding:'utf8'}),{module,exports:module.exports,require:name=>{if(Object.hasOwn(dependencies,name))return dependencies[name];throw Error('Unstubbed baseline dependency: '+name);}},{filename:file});return module.exports;}
const oldParser=oldModule('src/product-value-parsers.cjs',{});
const oldStock=oldModule('src/availability.js',{'./supabase':{},'./logger':log,'./httpClient':{},'./shopifyProduct':{}});
async function oldMoney(raw,currency){let saved;const db={from(table){let operation='read',body;const query={select(){return query;},eq(){return query;},single(){return query;},delete(){operation='delete';return query;},insert(value){operation='insert';body=value;return query;},update(value){operation='update';body=value;return query;},then(resolve,reject){if(table==='product_variants'&&operation==='insert')saved=body[0];return Promise.resolve({error:null,data:table==='products'&&operation==='insert'?{id:'fixture-product'}:null}).then(resolve,reject);}};return query;}};
const saver=oldModule('src/productSaver.js',{'./supabase':{getSupabase:()=>db},'./logger':log,'./imageDownloader':{},'./availability':{},'./product-value-parsers.cjs':oldParser});
await saver.saveProduct('owner',{name:'Fixture',default_price:raw,variant_price_currency:currency},'https://shop.test/products/fixture',log);return saved;}
(async()=>{const started=performance.now(),money=[];
for(const [raw,currency,locale,expectedMinor,expectedCurrency]of [
 ['12,00€',undefined,undefined,1200,'EUR'],['EUR 1.234,56','EUR','de-DE',123456,'EUR'],['USD 1,234.56','USD','en-US',123456,'USD'],
 ['1200','JPY','en-US',1200,'JPY'],['1.234','KWD','en-US',1234,'KWD'],['$12.00',undefined,undefined,null,null],['12.50','EUR €',undefined,1250,'EUR'],['140 Kč – 1250 Kč','CZK',undefined,null,'CZK'],
]){const before=await oldMoney(raw,currency),after=catalogPayload('11111111-1111-4111-8111-111111111111',{name:'Fixture',variants:[{title:'default',price:raw,currency,locale}]},'https://shop.test/products/fixture',null,null,new Date().toISOString()).variants[0];money.push({raw,expected:{minorUnits:expectedMinor,currency:expectedCurrency},before:{storedPrice:before.price_cents,currency:before.currency},after:{minorUnits:after.price_minor_units,currency:after.currency},before_correct:before.price_cents===expectedMinor&&before.currency===expectedCurrency,after_correct:after.price_minor_units===expectedMinor&&after.currency===expectedCurrency});}
const url='https://shop.test/products/main';
const primary={'@type':'Product',url,name:'Main',offers:{availability:'https://schema.org/OutOfStock'}};
const related={'@type':'Product',url:'https://shop.test/products/other',name:'Other',offers:{availability:'https://schema.org/InStock'}};
const stock=[];
for(const [name,input,expected]of [
 ['empty HTML',{},'unknown'],['price only',{html:'<p>USD 12.00</p>',allowPriceOnly:true},'unknown'],['unscoped buy button',{html:'<button>Add to cart</button>'},'unknown'],
 ['missing Shopify stock flag',{shopifyProduct:{variants:[{id:1}]}},'unknown'],
 ['primary sold-out plus related in-stock',{sourceUrl:url,html:`<script type="application/ld+json">${JSON.stringify([primary,related])}</script>`},'sold_out'],
 ['exact Shopify in stock',{shopifyProduct:{variants:[{id:1,available:true}]}},'in_stock'],['removed URL',{status:404},'removed'],
]){const b=oldStock.detectProductAvailability(input),a=productAvailability(input),before=b.reason==='product_url_unreachable'?'removed':b.isAvailable===true?'in_stock':b.isAvailable===false?'sold_out':'unknown';stock.push({name,expected,before,after:a.state,before_correct:before===expected,after_correct:a.state===expected});}
const summary={observed_at:new Date().toISOString(),baseline_commit:BASE,scope:'Offline deterministic money/availability fixtures; actual application functions, simulated database transport; not a representative merchant sample',money:{cases:money.length,before_correct:money.filter(x=>x.before_correct).length,after_correct:money.filter(x=>x.after_correct).length,details:money},availability:{cases:stock.length,before_correct:stock.filter(x=>x.before_correct).length,after_correct:stock.filter(x=>x.after_correct).length,details:stock},elapsed_ms:Number((performance.now()-started).toFixed(3)),actual_paid_ai_requests:0,actual_paid_ai_tokens:0,production_crawl_duration:null,production_cost_change:null};
fs.writeFileSync('docs/fixture-comparison.cjs','module.exports = '+JSON.stringify(summary,null,2)+';\n');console.log(JSON.stringify(summary,null,2));
if(summary.money.after_correct!==money.length||summary.availability.after_correct!==stock.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
