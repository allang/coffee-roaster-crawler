'use strict';
const cheerio=require('cheerio');
const {sameProduct}=require('../productEvidence');
const {parseMoney}=require('../catalogNormalization');
const {labelWeight}=require('../shopifyProduct');
function props(html,template) {
  const $=cheerio.load(html),nodes=$('script#props[type="application/json"]');
  if(nodes.length!==1)throw Error('Fathers primary JSON missing/ambiguous');
  let value;try{value=JSON.parse(nodes.text());}catch{throw Error('Invalid Fathers JSON');}
  if(value.template!==template || value.tenant?.locale!=='cs' || value.currency!=='CZK' || value.pricingLevel!=='B2c' || value.destinationCountry!=='Czechia')throw Error('Fathers retail market context changed');
  return {$,value};
}
function retailVariants(product) {
  if(!Array.isArray(product.variants) || !product.variants.length)throw Error('Fathers native variants missing');
  const variants=product.variants.filter(v=>['B2cAndB2b','B2c'].includes(v.visibilityScope));
  if(new Set(product.variants.map(v=>v.id)).size!==product.variants.length || product.variants.some(v=>typeof v.id!=='string' || !v.id))throw Error('Fathers variant identities invalid/repeated');
  return variants;
}
function owned(value,profile) {
  const url=new URL(value);if(url.protocol!=='https:' || !profile.hosts.includes(url.hostname) || !/^\/kava\/[^/]+\/[^/]+\/?$/.test(url.pathname) || url.search)throw Error('Fathers product owner/path mismatch');return url.href;
}
async function discoverFathersProducts(roaster,profile,fetchHtml) {
  const urls=new Set(),evidence=[];
  try {
    const url=new URL('/kava',roaster.website_url).href,response=await fetchHtml(url);
    if(!response.success)throw Error(response.error || 'Fathers listing fetch failed');
    const base=new URL(response.finalUrl || url);if(!profile.hosts.includes(base.hostname))throw Error('Fathers listing owner mismatch');
    const {$,value}=props(response.data,'ProductsListing');
    if(value.selectedCategory!=='Coffee' || !Array.isArray(value.products) || !Array.isArray(value.subcategories) || !value.products.length)throw Error('Fathers full catalog missing');
    if(new Set(value.subcategories.map(c=>c.id)).size!==value.subcategories.length)throw Error('Fathers category identity repeated');
    const categories=new Map(value.subcategories.map(c=>[c.id,c]));
    const products=value.products.filter(p=>p.active===true && categories.get(p.subcategoryId)?.active===true && categories.get(p.subcategoryId)?.category==='Coffee' && retailVariants(p).length);
    if(new Set(products.map(p=>p.id)).size!==products.length)throw Error('Fathers coffee product identity repeated');
    const cards=$('main article');
    for(const product of products) {
      const card=cards.filter((_,e)=>$(e).find('select').toArray().some(s=>$(s).attr('name')==='variants-'+product.id));
      if(card.length!==1)throw Error('Fathers catalog product not rendered exactly once');
      const links=[...new Set(card.find('a[href]').map((_,e)=>owned(new URL($(e).attr('href'),base).href,profile)).get())];
      if(links.length!==1 || new URL(links[0]).pathname.split('/').at(-1)!==product.urlSlug_cs)throw Error('Fathers catalog link identity mismatch');
      const rendered=card.find('select[name="variants-'+product.id+'"] option').map((_,e)=>$(e).attr('value')).get();
      if(rendered.length!==retailVariants(product).length || retailVariants(product).some(v=>!rendered.includes(v.id)))throw Error('Fathers retail options incomplete');
      urls.add(links[0]);
    }
    if(cards.length!==products.length || !urls.size || $('a[rel="next"], [class*="pagination"]').length)throw Error('Fathers inventory pagination/coverage changed');
    evidence.push({listing:url,hydratedProducts:value.products.length,renderedCoffeeProducts:products.length,currency:value.currency,destination:value.destinationCountry,pricingLevel:value.pricingLevel});
    return {supported:true,urls:[...urls],complete:true,evidence};
  }catch(error){return {supported:true,urls:[...urls],complete:false,error:error.message,evidence};}
}
function fathersProduct(html,url,profile) {
  owned(url,profile);const {$,value}=props(html,'ProductDetail'),product=value.product;
  if(!product?.id || value.subcategory?.category!=='Coffee' || product.subcategoryId!==value.subcategory.id || !sameProduct(new URL(value.pagePath?.cs,url).href,url))throw Error('Fathers primary product mismatch');
  const groups=[];$('script[type="application/ld+json"]').each((_,e)=>{try{const x=JSON.parse($(e).text());if(['ProductGroup','Product'].includes(x['@type']) && sameProduct(x.url,url))groups.push(x);}catch{}});
  if(groups.length!==1)throw Error('Fathers primary offer group missing/ambiguous');
  const group=groups[0],variants=retailVariants(product),members=group['@type']==='Product'?[group]:group.hasVariant;
  const text=value=>String(value || '').replace(/\s+/g,' ').trim();
  if((group['@type']==='ProductGroup' && group.productGroupID!==product.id) || (group['@type']==='Product' && variants.length!==1) || text(group.name)!==text(product.name?.cs) || text($('h1').first().text())!==text(group.name) || !Array.isArray(members) || members.length!==variants.length)throw Error('Fathers product/variant group mismatch');
  const offers=variants.map(v=>{
    const matching=members.filter(m=>m.sku===product.id+'::'+v.id);
    if(matching.length!==1)throw Error('Fathers exact variant offer missing/repeated');
    const member=matching[0],offer=member.offers;
    const markets=Object.values(v.prices?.[value.currency] || {}).filter(m=>m.countries?.includes(value.destinationCountry));
    if(markets.length!==1 || !offer || Array.isArray(offer) || !sameProduct(offer.url,url))throw Error('Fathers exact retail offer market missing');
    const schemaMarkets=Object.values(v.prices?.[offer.priceCurrency] || {}).filter(m=>m.countries?.includes(value.destinationCountry));
    const declared=parseMoney(offer.price,{currency:offer.priceCurrency,locale:'en-US'}),retail=parseMoney(markets[0].price?.withTax,{currency:value.currency,locale:'en-US'});
    if(schemaMarkets.length!==1 || declared.minorUnits==null || declared.minorUnits!==parseMoney(schemaMarkets[0].price?.withTax,{currency:offer.priceCurrency,locale:'en-US'}).minorUnits || retail.minorUnits==null)throw Error('Fathers exact retail offer price disagrees');
    // The primary page selects CZK/Czechia/B2c. Some schema offers are EUR;
    // verify those against their own exact variant/currency table, then use the
    // independently paired selected retail table. Never borrow a currency.
    // weightInGrams/schema weight can include packaging (100g coffee says 250).
    return {...offer,price:markets[0].price.withTax,priceCurrency:value.currency,sku:member.sku,name:v.label?.cs || member.name,_net_weight_g:labelWeight(v.label?.cs),_schema_currency:offer.priceCurrency};
  });
  const disclosures=(product.disclosures?.cs || []).map(d=>'<h3>'+d.title+'</h3>'+d.content).join('');
  return {'@type':'Product',url:group.url,productID:product.id,name:group.name,category:'coffee',image:group.image,description:(product.description?.cs || group.description || '')+disclosures,offers,_variants_complete:true,_market_source:'fathers_exact_czech_retail_variant_offers',_market_context:{currency:value.currency,destination:value.destinationCountry,pricing_level:value.pricingLevel,schema_currencies:[...new Set(offers.map(o=>o._schema_currency))]}};
}
module.exports={discoverFathersProducts,fathersProduct};
