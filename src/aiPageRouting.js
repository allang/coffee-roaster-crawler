'use strict';
const cheerio=require('cheerio');
const {structuredProduct}=require('./productEvidence');
function pathFor(value){try{const u=new URL(value);let p=u.pathname;for(let i=0;i<3;i++){const next=decodeURIComponent(p);if(next===p)break;p=next;}return {url:u,path:p.toLowerCase().replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/,'')};}catch{return {path:''};}}
function urlRoute(value){
 const {url,path}=pathFor(value);if(!url)return {category:'invalid_url',skip:true};
 if(/\.(?:pdf|jpe?g|png|gif|webp|svg|zip|xml|json|css|js|md|txt|csv|rss|atom)$/i.test(path))return {category:'non_html_asset',skip:true};
 // Product identities win over keywords in a product slug or collection name.
 if(/\/(?:products?|shop\/p|store\/p)\/[^/]+/.test(path) || /\/(?:shop_view|product\/detail)\/?(?:\.html)?$/.test(path) && [...url.searchParams.keys()].some(k=>['idx','product_no'].includes(k)))return {category:'product_candidate',skip:false};
 if(/^\/(?:cart|basket|checkout|accounts?|my-account|login|logout|search|admin|wp-admin)(?:[/.]|$)/.test(path) || url.searchParams.has('s') || url.searchParams.get('route')==='account/login')return {category:'utility',skip:true};
 if(/^\/(?:blogs?|news|articles?|journal|stories|events|careers)(?:\/|$)/.test(path))return {category:'editorial',skip:true};
 if(/^\/(?:policies|terms(?:-of-service)?|privacy(?:-policy)?|legal)(?:[/.]|$)/.test(path))return {category:'policy',skip:true};
 if(/^\/(?:pages\/)?(?:about(?:-us)?|contact(?:-us)?|faq|faqs|shipping(?:-policy)?|returns(?:-policy)?|refund-policy|wholesale|stockists|locations)(?:[/.]|$)/.test(path))return {category:'information',skip:true};
 return {category:'ambiguous_product_candidate',skip:false};
}
function pageRoute({url,html,sourceProduct,native}){
 const $=cheerio.load(html || ''),primary=sourceProduct || structuredProduct(html,url),product=native || primary;
 const title=product?.title || product?.name || '',type=String(product?.productType || product?.category || '').trim();
 if(product && (/^(?:(?:coffee |brewing )?equipment|merchandise|apparel|accessories|(?:coffee )?grinders?|brewers?|gift cards?|drinkware|cups?|mugs?|hats?|clothing|filters?|scales?|kettles?)$/i.test(type) || /\b(?:green coffee|rohkaffee|gift card)\b/i.test(title) || /^(?:cascara|hibiscus)\b/i.test(title)))return {category:'non_coffee_product',skip:true};
 if(product?.title || product?.name)return {category:'product_candidate',skip:false};
 $('nav,header,footer,aside,product-recommendations,cart-drawer,cart-notification,[data-cart-drawer],.related-products,.recommendations').remove();
 const purchase=$('form[action*="/cart/add"],form.cart input[name="product_id"],button[name="add-to-cart"],button[data-add-to-cart],form input[name="add-to-cart"]').length>0;
 if(purchase && $('h1').length===1)return {category:'product_candidate',skip:false};
 const route=urlRoute(url);if(route.skip)return route;
 const types=new Set();$('script[type="application/ld+json"]').each((_,node)=>{try{for(const value of [JSON.parse($(node).text())].flat()){for(const item of [value,...[value?.['@graph'] || []].flat()])for(const type of [item?.['@type']].flat())types.add(String(type).split('/').pop());}}catch{}});
 if(['Article','BlogPosting','NewsArticle'].some(t=>types.has(t)))return {category:'editorial',skip:true};
 if(['FAQPage','AboutPage','ContactPage','SearchResultsPage'].some(t=>types.has(t)))return {category:'information',skip:true};
 const {path}=pathFor(url);
 const listing=/^\/(?:collections?(?:\/[^/]+)?|categories(?:\/[^/]+)?|shop|store|coffees?)\/?$/.test(path) || types.has('CollectionPage') || types.has('ItemList') || $('[data-controller="ProductList"]').length>0 || $('.products .product,.product-grid .product-card').length>1;
 if(listing)return {category:'listing',skip:true};
 if(!path || path==='/')return {category:'homepage',skip:true};
 const heading=$('h1').first().text().trim();
 if(/^(?:about(?: us)?|contact(?: us)?|frequently asked questions|privacy policy|shipping policy|terms of service)$/i.test(heading))return {category:'information',skip:true};
 return route;
}
function pageOrder(known=new Map()){
 return (a,b)=>{const key=v=>typeof v==='string'?v:v.url,rank=v=>{const row=known.get(key(v));return row?.last_fetched_at?Date.parse(row.last_fetched_at)||0:-Infinity;};return rank(a)-rank(b) || 0;};
}
module.exports={urlRoute,pageRoute,pageOrder};
