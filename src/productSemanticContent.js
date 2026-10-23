'use strict';
const cheerio=require('cheerio');
// These containers describe other products or transactional UI, not this
// coffee. Keep unrecognized page text so changed source facts invalidate cache.
const CHROME='script,style,nav,footer,header,noscript,iframe,product-recommendations,[data-product-recommendations],.related-products,.recommendations,.recently-viewed,cart-drawer,cart-notification,#CartDrawer,#cart-drawer,[data-cart-drawer],predictive-search,[data-predictive-search],.cookie-banner,[data-cookie-banner]';
function bodyText(page,{market=false}={}) {
 const $=cheerio.load(page.html || '');$(CHROME).remove();
 if(!market)$('form#product-form,form[data-primary-product],form[action*="/cart/add"],[itemprop="price"],[itemprop="availability"],.price,.money,.stock').remove();
 return $('body').text().replace(/\s+/g,' ').trim();
}
function productTitle(page,structured) {
 return structured.product?.name || page.title || cheerio.load(page.html || '')('title').text().trim();
}
function classificationContent(page,structured) {
 const body=bodyText(page,{market:true}) || page.content || '';
 const description=structured.product?.description_raw || '';
 const title=productTitle(page,structured);
 const parts=[title?`Product/page title: ${title}`:'',body];
 if(description && !body.includes(description))parts.unshift(description);
 const labels=structured.product?.variants?.map(v=>v.title).filter(Boolean);
 if(labels?.length)parts.push('Current product variant labels: '+[...new Set(labels)].join('; '));
 return parts.join('\n').slice(0,Number(process.env.CLASSIFIER_MAX_CHARS || 15000));
}
module.exports={bodyText,productTitle,classificationContent};
