'use strict';

// Catalog prices use hundredths of the displayed currency (including CLP/JPY).
// Reject ranges and ambiguous punctuation rather than manufacture a price.
const MAX_DATABASE_INTEGER = 2147483647;
function parsePriceCents(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    const cents = Math.round(input * 100);
    return cents <= MAX_DATABASE_INTEGER ? cents : null;
  }
  if (typeof input !== 'string') return null;
  const text = input.normalize('NFKC').trim();
  if (!text || /[-–—−+%/]/u.test(text)) return null;
  const match = text.match(/\d(?:[\d.,'’\s]*\d)?/u);
  if (!match) return null;
  const prefix = text.slice(0, match.index).trim();
  const suffix = text.slice(match.index + match[0].length).trim();
  // Currency symbols/codes may flank the number; ordinary prose may not.
  const affix = /^(?:(?:[A-Z]{3}|Kč|kr|R|S\$|[A-Z]{1,2}\$|[$€£¥₩₹₽₺₫฿₱₪₴₦₡₲₵₸₼₾])\s*)*$/u;
  if (!affix.test(prefix) || !affix.test(suffix.replace(/\s*TTC$/u, '').trim())) return null;
  let amount = match[0].trim();
  // Spaces and apostrophes are accepted only as regular thousand groups.
  if (/[\s'’]/u.test(amount)) {
    if (!/^\d{1,3}(?:[\s'’]\d{3})+(?:[.,]\d{1,2})?$/u.test(amount)) return null;
    amount = amount.replace(/[\s'’]/gu, '');
  }
  const dots = (amount.match(/\./g) || []).length;
  const commas = (amount.match(/,/g) || []).length;
  if (dots && commas) {
    const decimal = amount.lastIndexOf('.') > amount.lastIndexOf(',') ? '.' : ',';
    const grouping = decimal === '.' ? ',' : '.';
    const pattern = decimal === '.' ? /^\d{1,3}(?:,\d{3})+\.\d{1,2}$/ : /^\d{1,3}(?:\.\d{3})+,\d{1,2}$/;
    if (!pattern.test(amount)) return null;
    amount = amount.split(grouping).join('').replace(decimal, '.');
  } else if (dots || commas) {
    // One separator with three trailing digits is locale-ambiguous.
    if (!/^\d+[.,]\d{1,2}$/.test(amount)) return null;
    amount = amount.replace(',', '.');
  } else if (!/^\d+$/.test(amount)) return null;
  const cents = Math.round(Number(amount) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_DATABASE_INTEGER ? cents : null;
}

function parseWeightGrams(input) {
  if (typeof input !== 'string') return null;
  const text = input.normalize('NFKC').toLowerCase();
  if (/\d\s*(?:x|×)\s*\d|(?:x|×)\s*\d|\d\s*(?:bags?|packs?|packets?)\b|[-–—−]/u.test(text)) return null;
  const matches = [...text.matchAll(/(?<![\d.,])\b(\d+(?:[.,]\d{1,3})?)\s*(kilogramm|kilograms?|kg|gramm|grams?|gr|g|ounces?|oz|pounds?|lbs?)\b/gu)];
  if (matches.length !== 1) return null;
  const [, numeric, unit] = matches[0];
  if (/[.,]\d{3}$/.test(numeric)) return null;
  const amount = Number(numeric.replace(',', '.'));
  const factor = /^(kg|kilo)/.test(unit) ? 1000 : /^(oz|ounce)/.test(unit) ? 28.349523125 : /^(lb|pound)/.test(unit) ? 453.59237 : 1;
  const grams = Math.round(amount * factor);
  return Number.isSafeInteger(grams) && grams > 0 && grams <= MAX_DATABASE_INTEGER ? grams : null;
}

module.exports = { parsePriceCents, parseWeightGrams, MAX_DATABASE_INTEGER };
