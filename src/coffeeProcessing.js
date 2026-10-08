'use strict';
const cheerio=require('cheerio');
const PROCESSING_VERSION='processing-v1';
const METHOD_RULES=[
 ['washed',/\b(?:washed|lavado|lavada|lave|gewaschen)\b/],
 ['natural',/\b(?:natural|naturel|naturale|naturals)\b/],
 ['honey',/\b(?:honey|miel)\b/],
 ['wet_hulled',/\b(?:wet[ -]hulled|giling basah)\b/],
 ['anaerobic',/\b(?:anaerobic|anaerobico|anaerobica|anaerob|anaerobe|anaeroben)\b/],
 ['aerobic',/\b(?:aerobic|aerobico|aerobica|aerob)\b/],
 ['carbonic_maceration',/\b(?:carbonic maceration|maceracion carbonica|maceration carbonique)\b/],
 ['lactic_fermentation',/\b(?:lactic|lactico|lactica|lactique)\b/],
 ['thermal_shock',/\bthermal shock\b/],
];
// A processing label can explicitly deny a method. Keep its original wording,
// but require a positive occurrence before adding a searchable method.
const NEGATION=String.raw`\b(?:not|no|non|without|never|sin|nicht)`;
const METHOD_WORDS=METHOD_RULES.map(([,pattern])=>'(?:'+pattern.source+')').join('|');
const DIRECT_NEGATION=new RegExp(NEGATION+String.raw`(?:[ -]+(?:actually|necessarily|really|ever|fully|been)){0,2}[ -]*$`);
const JOINED_NEGATION=new RegExp(NEGATION+String.raw`[ -]+(?:`+METHOD_WORDS+String.raw`)(?:\s*(?:and|or|y|und|/)\s*(?:`+METHOD_WORDS+String.raw`))*\s*(?:and|or|y|und|/)\s*$`);
function positiveMethod(text,pattern) {
 for(const match of text.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'))) {
  const lead=text.slice(0,match.index).split(/[,;.!?()]|\b(?:but|however|yet|sondern|pero)\b/).at(-1);
  if(DIRECT_NEGATION.test(lead)||JOINED_NEGATION.test(lead)||/\b(?:instead of|rather than)\s*$/.test(lead))continue;
  return true;
 }
 return false;
}
const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').replace(/[\u2010-\u2015]/g,'-').toLowerCase();
const clean=value=>typeof value==='string'&&value.trim()&&!/^(?:null|unknown|n\/a)$/i.test(value.trim())?value.replace(/\s+/g,' ').trim():null;
const PROCESS_LABEL=/^(?:coffee\s+)?(?:process(?:ing)?(?:\s+method)?|processing_method|proceso|procesamiento|aufbereitung|verarbeitung|methode de traitement)\s*:?$/i;
function textLines(html) {
 const $=cheerio.load(html||'');$('script,style,nav,footer,header,aside,.related-products,.related,.recommendations,.upsells,[data-product-recommendations]').remove();
 $('strong,b,span').each((i,el)=>{if(PROCESS_LABEL.test($(el).text().trim()))$(el).append('\n');});
 $('br').replaceWith('\n');$('p,div,li,dt,dd,tr,td,h1,h2,h3').each((i,el)=>$(el).append('\n'));
 return $.text().split(/\n/).map(clean).filter(Boolean);
}
function scopedDescription(html) {
 const $=cheerio.load(html||'');
 const selectors=['[itemprop="description"]','[data-product-description]','.product__description','.product-description','.woocommerce-product-details__short-description','#tab-description','.woocommerce-product-attributes','table[data-product-attributes]','.product__specifications'];
 const blocks=[];
 for(const selector of selectors){const nodes=$(selector).filter((i,el)=>!$(el).parents('aside,nav,footer,header,.related-products,.related,.recommendations,.upsells,[data-product-recommendations]').length);if(nodes.length===1){const block=$.html(nodes[0])||nodes.text();if(!blocks.includes(block))blocks.push(block);}}
 return blocks.length?blocks.join('\n'):null; // Never scan the whole page for a processing claim.
}
function labeledProcess(lines) {
 for(let i=0;i<lines.length;i++) {
  const match=lines[i].match(/^(?:coffee\s+)?(?:process(?:ing)?(?:\s+method)?|processing_method|proceso|procesamiento|aufbereitung|verarbeitung|methode de traitement)(?:\s*(?::|[-\u2013\u2014])\s*(.*)|\s*)$/i);
  if(match){let value=clean(match[1]);for(let offset=1;!value&&offset<=2;offset++)value=clean((lines[i+offset]||'').replace(/^\s*[:\-\u2013\u2014]\s*/,''));if(value&&!/^(?:country|origin|variet|altitude|notes|roast)\b/i.test(value))return value.slice(0,400);}
 }
 return null;
}
function snippet(line,pattern) {const index=line.search(pattern);return line.slice(Math.max(0,index-100),index+450);}
function processingForProduct(product,{sourceText,sourceAttributes,source='product_description',title}={}) {
 const attrs=product.attributes||{};
 const description=sourceText??product.description_html??product.description_raw??attrs.original_description??attrs.description??'';
 const lines=textLines(description),label=labeledProcess(lines);
 const supplied=clean(Array.isArray(attrs.process)?attrs.process.join(' / '):attrs.process)||clean(attrs.processing_method)||clean(attrs.process_raw);
 let processRaw=label||supplied;
 if(!processRaw&&Array.isArray(sourceAttributes?.process_methods))processRaw=clean(sourceAttributes.process_methods.filter(v=>typeof v==='string').join(' / '));
 const productTitle=title??product.name??'';
 // Distinctive fermentation wording can be explicit in the original product title;
 // generic natural/honey tasting adjectives are not process evidence.
 if(!processRaw){const match=productTitle.match(/\b(?:anaerobic|carbonic maceration|thermal shock)\b/i);if(match&&positiveMethod(fold(productTitle),new RegExp(match[0],'i')))processRaw=match[0];}
 const methods=processRaw&&!/\b(?:maybe|possibly|unknown|uncertain)\b|\?/i.test(processRaw)?METHOD_RULES.filter(([,r])=>positiveMethod(fold(processRaw),r)).map(([name])=>name):[];
 const coPattern=/\b(?:co|ko)[\s\u2010-\u2015-]?ferment\w*/i;
 const claims=[...(processRaw?[{text:processRaw,source:'process_field'}]:[]),{text:productTitle,source:'product_title'},...lines.flatMap(line=>line.match(/[^.!?]+[.!?]?/g)||[line]).filter(line=>coPattern.test(fold(line))).map(text=>({text,source}))];
 let positive=false,negative=false;const disclosures=[];
 for(const claim of claims){
  const text=fold(claim.text),index=text.search(coPattern),lead=text.slice(Math.max(0,index-80),index);
  if(index<0||/\?/.test(claim.text)||/\b(?:can|could|might|may|possibly|unlike)(?:\s+\w+){0,4}\s*$/.test(lead))continue;
  const negated=/\b(?:not|no|non|without|never|sin|nicht)(?:[ -]+\w+){0,3}[ -]+(?:co|ko)[ -]?ferment/.test(text)&&!/\bnot (?:only|just|merely)[ -]+(?:co|ko)[ -]?ferment/.test(text);
  if(negated)negative=true;else positive=true;
  disclosures.push({source:claim.source,quote:snippet(claim.text,coPattern),value:!negated});
 }
 const declared=sourceAttributes?.is_coferment;
 const explicitFlag=typeof declared==='boolean'?declared:/^(?:true|yes)$/i.test(String(declared))?true:/^(?:false|no)$/i.test(String(declared))?false:null;
 if(explicitFlag!==null){
  if(explicitFlag)positive=true;else negative=true;
  disclosures.push({source:'structured_property',property:'is_coferment',source_value:declared,value:explicitFlag});
 }
 const isCoferment=positive===negative?null:positive;
 const ingredients=[],ingredientEvidence=[];
 const addIngredient=(value,quote,kind)=>{const name=clean(value);if(name&&name.length<=80&&!/^(?:yes|no|true|false|coffee(?: cherries| pulp| mucilage)?|mucilage)$/i.test(name)&&!ingredients.some(v=>fold(v)===fold(name))){ingredients.push(name);ingredientEvidence.push({source:kind,quote,value:name});}};
 if(isCoferment===true){
  for(const line of lines){
   const match=line.match(/\b(?:co[\s\u2010-\u2015-]?ferment\w*|ferment(?:ed|ation))\s+(?:together\s+)?(?:with|using)\s+([^.;\n]{1,160})/i);
   if(match&&!/\b(?:notes|tastes|flavou?r|aroma|reminiscent)\b/i.test(match[1]))for(const part of match[1].split(/,|\s+and\s+|\s*&\s*/i))addIngredient(part,match[0],source);
  }
  if(Array.isArray(sourceAttributes?.coferment_ingredients))for(const value of sourceAttributes.coferment_ingredients)addIngredient(value,null,'structured_property');
 }
 return {version:PROCESSING_VERSION,process:processRaw,process_methods:methods,is_coferment:isCoferment,coferment_ingredients:ingredients,
  evidence:{version:PROCESSING_VERSION,process:processRaw?{source:label?source:'extracted_process_field',quote:processRaw}:null,coferment:disclosures,coferment_conflict:positive&&negative,ingredients:ingredientEvidence}};
}
module.exports={PROCESSING_VERSION,METHOD_RULES,processingForProduct,textLines,scopedDescription};
