'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {auditCatalog,costEstimate}=require('../scripts/audit-catalog.cjs');
test('offline audit distinguishes proposals and unknown money from source-verified corrections',()=>{
 const result=auditCatalog({rows:[{id:'1',entity_id:'a',name:'Coffee',metadata:{},description_html:'<p>Process: Anaerobic Natural</p><p>Co-fermented with watermelon.</p>',coffee_facts:{process:null},product_variants:[{id:'v1',currency:'USD',price_minor_units:2000,price_amount:20,currency_exponent:2},{id:'v2',currency:null,price_minor_units:null,price_amount:'12',currency_exponent:null}]},{id:'2',entity_id:'b',name:'Coffee',metadata:{country_of_origin:'Ethiopia',process:'Washed'},coffee_facts:[{process:'Natural'}],product_variants:[{id:'v3',currency:'KWD',price_minor_units:1500,price_amount:1.5,currency_exponent:3},{id:'v4',currency:'USD',price_minor_units:200,price_amount:20,currency_exponent:3}]}]});
 assert.equal(result.summary.counts.missing_process,1);assert.equal(result.summary.counts.process_candidates_from_retained_source,1);assert.equal(result.summary.counts.coferment_disclosed_in_retained_source,1);assert.equal(result.summary.counts.missing_origin,1);
 assert.equal(result.summary.counts.money_incomplete,1);assert.equal(result.summary.counts.money_arithmetic_mismatch,1);assert.equal(result.summary.counts.money_currency_precision_mismatch,1);assert.equal(result.summary.counts.process_field_disagreements,1);
 assert.equal(result.summary.model_calls,0);assert.equal(result.summary.database_writes,0);assert(result.candidates[0].flags.includes('process_missing'));
});
test('cleanup estimates use explicit uncached rates and a retry reserve, including billed output tokens',()=>{
 assert.deepEqual([costEstimate(1000).usd_low,costEstimate(1000).usd_high],[3.125,8.75]);
 assert.deepEqual([costEstimate(10000).usd_low,costEstimate(10000).usd_high],[31.25,87.5]);
 assert.throws(()=>costEstimate(-1));assert.throws(()=>costEstimate(1.5));
});
