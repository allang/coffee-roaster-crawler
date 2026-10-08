'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parsePriceCents: price, parseWeightGrams: weight} = require('./product-value-parsers.cjs');

for (const [input, expected] of [
  ['12,00€',1200],['14,40€ TTC',1440],['€13.00',1300],['AUD 65.00',6500],
  ['$20.00',2000],['1.250,00 Kč',125000],['USD 1,250.00',125000],['12 500,00 Kč',1250000],
  ["CHF 1’250.50",125050],['140,00 Kč – 1250,00 Kč',null],['12-20',null],
  ['from $12.00',null],['2 bags $12.00',null],['$12 per 250g',null],['20% off',null],
  ['1.234',null],['1,234',null],['1,23,45',null],['1.234.56',null],['2e3',null],
  ['-12.00',null],['(12.00)',null],['$12.50 / month',null],['25000 CLP',2500000],
  ['0',0],['21474836.47',2147483647],['21474836.48',null],[12.99,1299],
  [Infinity,null],[NaN,null],[-1,null],[null,null],[undefined,null],[{},null],['',null],
]) test('price '+JSON.stringify(input),()=>assert.equal(price(input),expected));

for (const [input, expected] of [
  ['250g',250],['1kg / Whole Beans',1000],['Pocket Rocket (250g) / espresso',250],
  ['340gr',340],['1,5 kg',1500],['12 oz',340],['1lb',454],['2 pounds',907],
  ['0.5 kilogram',500],['250 grams',250],['2 x 250g',null],['250g / 1kg',null],
  ['250–500g',null],['-250g',null],['12',null],['default',null],[null,null],[123,null],
  ['1.000g',null],['1,000g',null],['250g x 2',null],['250g × 2',null],['2 bags of 250g',null],
]) test('weight '+JSON.stringify(input),()=>assert.equal(weight(input),expected));

// Exact nine labels observed on both Strawanzer pilot products (18 saved rows).
for (const grams of [250,500,1000]) for (const grind of ['Ganze Bohnen','Gemahlen für Siebträger','Gemahlen für Espressokocher']) {
  const label = `${grams} Gramm / ${grind}`;
  test('observed German weight '+label,()=>assert.equal(weight(label),grams));
}
for (const [input, expected] of [
  ['1 Kilogramm',1000],['0.5 Kilogramm / Ganze Bohnen',500],['1,5 Kilogramm',1500],
  ['250 Grammatik',null],['1 Kilogrammeter',null],['250 Gramm / 500 Gramm',null],
  ['250–500 Gramm',null],['250 Gramm - 500 Gramm',null],['2 x 250 Gramm',null],
  ['250 Gramm x 2',null],['2 bags of 250 Gramm',null],['1.000 Gramm',null],
  ['1,000 Gramm',null],['250 Gramm / Espresso - fein',null],['-250 Gramm',null],
  ['0 Gramm',null],['2147483648 Gramm',null],
]) test('German unit boundary and safety '+JSON.stringify(input),()=>assert.equal(weight(input),expected));
