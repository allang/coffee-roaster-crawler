'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const {translationFixture}=require('./catalogDb');
const {parseShopifyProduct}=require('../src/shopifyProduct');
const owner='11111111-1111-4111-8111-111111111111',url='https://shop.test/products/coffee',model='fixture-model',log=new Proxy({},{get:()=>()=>{}});
function fixture() {
 const native={id:123,title:'Coffee Ethiopia',currency:'EUR',product_type:'Coffee',body_html:'<p>Coffee from Ethiopia, washed.</p>',variants:[{id:1,title:'250g / Whole Bean',grams:250,price:'12.00',available:true},{id:2,title:'250g / Espresso',grams:250,price:'12.00',available:true}]};
 return {native,html:html(),aiCalls:0,translationCalls:0,inputs:[],extracted:{name:native.title,attributes:{description:'Coffee from Ethiopia, washed.',producer:'Farm A',short_description:'Coffee from Ethiopia',process:'Washed',flavor_notes:['Peach']}}};
}
function html(noise='Original',facts='Farm A') {return `<html><head><title>Cart ${noise}</title></head><body><main><h1>Coffee Ethiopia</h1><p>Producer: ${facts}</p><p>Coffee from Ethiopia, washed.</p><span class="money">${noise} EUR</span><form action="/cart/add">${noise}</form><product-recommendations>Unrelated Kenya coffee ${noise}</product-recommendations><cart-drawer>${noise}</cart-drawer></main><p>Primary additional fact: 1800m</p><footer>${noise}</footer></body></html>`;}
function sourcePage(markup=html()) {return {url,finalUrl:url,html:markup,content:'Original full page',success:true,status:200};}
function visitor(db,state,sourceRoot=path.join(__dirname,'../src')) {
 const modules=new Map(),root=sourceRoot;
 function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const real=createRequire(file);
  const mocked=name=>{
   if(name==='./supabase')return {getSupabase:()=>db};if(name==='./logger')return log;
   if(name==='./config')return {config:{crawler:{requestDelayMs:0}}};
   if(name==='./gptClassifier')return {MODEL:model,classifyPage:async content=>{state.aiCalls++;state.inputs.push(content);return {aiCalls:1,data:{is_coffee_page:true,product:state.extracted}};},translateTexts:async bundle=>{state.translationCalls++;return {...await translationFixture(bundle),aiCalls:1};}};
   if(name==='./imageDownloader')return {downloadAndSaveImage:async()=>null};
   if(name==='./httpClient')return {fetchHtml:async()=>({success:true,data:state.html,status:200,finalUrl:url}),jitteredSleep:async()=>{}};
   if(name==='./shopifyProduct')return {...real(name),fetchShopifyProductJson:async()=>({success:true,raw:state.native,data:parseShopifyProduct(state.native)})};
   if(name.startsWith('./')&&!name.endsWith('.cjs')&&!name.endsWith('.json'))return load(real.resolve(name));return real(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(file,'utf8')}\n})`,{filename:file})(mocked,module,module.exports);return module.exports;
 }
 return load(path.join(root,'pageVisitor.js'));
}
module.exports={fixture,html,sourcePage,visitor,owner,url,model,log};
