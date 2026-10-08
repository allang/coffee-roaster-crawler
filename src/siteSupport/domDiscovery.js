'use strict';
const cheerio=require('cheerio');
const {canonicalProductUrl}=require('../catalogNormalization');
async function discoverDomProducts(roaster,profile,fetchHtml) {
  const urls=new Set(),evidence=[];
  try {
    for(const path of profile.listing_paths) {
      let next=new URL(path,roaster.website_url).href;const seen=new Set();
      for(let page=0;next;page++) {
        if(page>=30 || seen.has(next))throw Error('Merchant listing pagination incomplete');seen.add(next);
        const response=await fetchHtml(next);if(!response.success)throw Error(response.error || 'Listing fetch failed');
        const base=new URL(response.finalUrl || next);if(!profile.hosts.includes(base.hostname))throw Error('Listing owner mismatch');
        const $=cheerio.load(response.data),links=$(profile.product_link_selector).filter((_,e)=>!profile.exclude_name_pattern || !new RegExp(profile.exclude_name_pattern,'i').test($(e).closest('li').find(profile.product_name_selector || '.name').text())).map((_,e)=>$(e).attr('href')).get();
        for(const href of links) {
          const product=new URL(href.replace(/&amp;/g,'&'),base);
          const number=product.searchParams.get('product_no') || product.pathname.match(/^\/product\/[^/]+\/([1-9]\d+)(?:\/|$)/)?.[1];
          if(!profile.hosts.includes(product.hostname) || !/^[1-9]\d*$/.test(number || ''))throw Error('Invalid merchant product link');
          // Category/display aliases are one native product, not extra inventory.
          product.pathname='/product/detail.html';product.search='';product.hash='';product.searchParams.set('product_no',number);urls.add(product.href);
        }
        evidence.push({listing:next,products:links.length});
        const active=$('.xans-product-normalpaging ol a.this').first();
        const current=Number(active.text());
        if(profile.require_pagination && (!Number.isInteger(current) || current<1))throw Error('Merchant listing pagination missing');
        const later=$('.xans-product-normalpaging ol a').toArray().map(e=>({text:Number($(e).text()),href:$(e).attr('href')})).find(e=>e.text===current+1);
        next=later?.href?new URL(later.href.replace(/&amp;/g,'&'),base).href:null;
      }
    }
    if(!urls.size)throw Error('No merchant coffee links found');
    return {supported:true,urls:[...urls],complete:true,evidence};
  }catch(error){return {supported:true,urls:[...urls],complete:false,error:error.message,evidence};}
}
module.exports={discoverDomProducts};
