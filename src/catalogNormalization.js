'use strict';

const crypto = require('node:crypto');
const { parseWeightGrams } = require('./product-value-parsers.cjs');
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const SYMBOLS = { '€': 'EUR', '£': 'GBP', 'Kč': 'CZK', '₩': 'KRW', '₹': 'INR', '₽': 'RUB', '₺': 'TRY', '₫': 'VND', '₪': 'ILS', '₴': 'UAH', '₦': 'NGN', 'S$': 'SGD', 'CA$': 'CAD', 'C$': 'CAD', 'A$': 'AUD', 'AU$': 'AUD', 'US$': 'USD', 'NZ$': 'NZD' };
const NORMALIZATION_VERSION = 'coffee-v1';

function currencyCode(value) {
  const code = SYMBOLS[String(value || '').trim()] || String(value || '').trim().toUpperCase();
  return CURRENCIES.has(code) ? code : null;
}

// Return amount AND currency. Never assume USD for an ambiguous "$" or a bare number.
function parseMoney(raw, { currency: explicitCurrency, locale } = {}) {
  const text = String(raw ?? '').normalize('NFKC').trim();
  const explicit = currencyCode(explicitCurrency);
  const found = new Set([...text.matchAll(/\b[A-Z]{3}\b/gi)].map(m => currencyCode(m[0])).filter(Boolean));
  const symbolPattern = Object.keys(SYMBOLS).sort((a,b) => b.length-a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  for (const match of text.matchAll(new RegExp(symbolPattern, 'g'))) found.add(SYMBOLS[match[0]]);
  if (explicit) found.add(explicit);
  const currency = found.size === 1 ? [...found][0] : null;
  const exponent = currency ? new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits : null;
  const result = { raw: raw ?? null, amount: null, currency, exponent, minorUnits: null, reason: null };
  if (found.size > 1 || (explicitCurrency && !explicit)) return { ...result, currency: null, exponent: null, reason: 'conflicting_or_invalid_currency' };
  if (!text || /[-–—−+%/]/u.test(text)) return { ...result, reason: 'missing_or_range_price' };
  const match = text.match(/\d(?:[\d.,'’\s]*\d)?/u);
  if (!match) return { ...result, reason: 'missing_amount' };
  const affix = /^(?:(?:[A-Z]{3}|Kč|kr|R|S\$|[A-Z]{1,2}\$|[$€£¥₩₹₽₺₫฿₱₪₴₦₡₲₵₸₼₾])\s*)*$/iu;
  if (!affix.test(text.slice(0, match.index).trim()) || !affix.test(text.slice(match.index + match[0].length).replace(/\s*TTC$/u, '').trim())) return { ...result, reason: 'price_prose' };
  let numeric = match[0].trim();
  const precision = exponent ?? 2;
  if (/[\s'’]/u.test(numeric)) {
    if (!/^\d{1,3}(?:[\s'’]\d{3})+(?:[.,]\d{1,3})?$/u.test(numeric)) return { ...result, reason: 'invalid_grouping' };
    numeric = numeric.replace(/[\s'’]/gu, '');
  }
  let decimal;
  if (locale) {
    let parts;
    try { parts = new Intl.NumberFormat(locale).formatToParts(1234.5); } catch { return { ...result, reason: 'invalid_locale' }; }
    decimal = parts.find(p => p.type === 'decimal')?.value;
    const grouping = parts.find(p => p.type === 'group')?.value;
    if (grouping && /[.,]/.test(grouping) && numeric.includes(grouping)) {
      const escaped = grouping === '.' ? '\\.' : ',';
      if (!new RegExp(`^\\d{1,3}(?:${escaped}\\d{3})+(?:${decimal === '.' ? '\\.' : decimal}\\d+)?$`).test(numeric)) return { ...result, reason: 'invalid_grouping' };
      numeric = numeric.split(grouping).join('');
    }
  } else if (numeric.includes('.') && numeric.includes(',')) {
    decimal = numeric.lastIndexOf('.') > numeric.lastIndexOf(',') ? '.' : ',';
    const grouping = decimal === '.' ? ',' : '.';
    if (!(decimal === '.' ? /^\d{1,3}(?:,\d{3})+\.\d+$/ : /^\d{1,3}(?:\.\d{3})+,\d+$/).test(numeric)) return { ...result, reason: 'invalid_grouping' };
    numeric = numeric.split(grouping).join('');
  } else {
    decimal = numeric.includes(',') ? ',' : '.';
    if (/^[\d]+[.,]\d{3}$/.test(numeric)) return { ...result, reason: 'locale_required' };
  }
  numeric = numeric.replace(decimal, '.');
  if (!/^\d+(?:\.\d+)?$/.test(numeric)) return { ...result, reason: 'invalid_amount' };
  const [whole, fraction = ''] = numeric.split('.');
  if (fraction.length > precision && /[1-9]/.test(fraction.slice(precision))) return { ...result, reason: 'currency_precision' };
  const amount = `${BigInt(whole)}${precision ? '.' + fraction.slice(0, precision).padEnd(precision, '0') : ''}`;
  const minor = BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.slice(0, precision).padEnd(precision, '0') || '0');
  if (minor > 2147483647n) return { ...result, reason: 'amount_overflow' };
  return { ...result, amount, minorUnits: currency ? Number(minor) : null, reason: currency ? null : 'unknown_currency' };
}

function displayTitle(original, attributes = {}) {
  let title = String(original || '').trim();
  for (const origin of [attributes.country_of_origin, attributes.origin_region].filter(v => typeof v === 'string' && v.trim())) {
    const escaped = origin.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const candidate = title.replace(new RegExp(`^(?:single origin\\s*[:—–-]\\s*)?${escaped}\\s*[:|—–-]\\s*`, 'i'), '').trim();
    if (candidate) title = candidate;
  }
  if (title === title.toUpperCase() && /\p{L}/u.test(title)) {
    const acronyms = /^(?:EA|SWP|COE|F1|SL\d+|USDA|SCA|AA|AAA|AB|PB)$/;
    title = title.replace(/[\p{L}\d]+/gu, word => acronyms.test(word) ? word : word[0] + word.slice(1).toLowerCase());
  }
  return title;
}

const NOTES = {
  blueberry: ['fruit', 'berry'], strawberry: ['fruit', 'berry'], raspberry: ['fruit', 'berry'], blackberry: ['fruit', 'berry'],
  lemon: ['fruit', 'citrus'], lime: ['fruit', 'citrus'], orange: ['fruit', 'citrus'], grapefruit: ['fruit', 'citrus'],
  peach: ['fruit', 'stone-fruit'], apricot: ['fruit', 'stone-fruit'], cherry: ['fruit', 'stone-fruit'],
  apple: ['fruit', 'pome-fruit'], pear: ['fruit', 'pome-fruit'], pineapple: ['fruit', 'tropical'], mango: ['fruit', 'tropical'],
  chocolate: ['sweet', 'chocolate'], 'dark chocolate': ['sweet', 'chocolate'], 'milk chocolate': ['sweet', 'chocolate'], cocoa: ['sweet', 'chocolate'],
  caramel: ['sweet', 'sugar'], honey: ['sweet', 'sugar'], 'brown sugar': ['sweet', 'sugar'], vanilla: ['sweet', 'spice'],
  almond: ['nut', 'almond'], hazelnut: ['nut', 'hazelnut'], walnut: ['nut', 'walnut'], jasmine: ['floral', 'white-flower'], rose: ['floral', 'rose'],
};
const NOTE_ALIASES = { blueberries: 'blueberry', strawberries: 'strawberry', raspberries: 'raspberry', blackberries: 'blackberry', cacao: 'cocoa', 'chocolat noir': 'dark chocolate', 'dark choc': 'dark chocolate', 'milk choc': 'milk chocolate', 'caramelo': 'caramel' };
function tastingNotes(source) {
  const raw = Array.isArray(source) ? source : typeof source === 'string' ? source.split(/[,;|]/) : [];
  return { version: 'tasting-v1', source: source ?? null, notes: raw.map(value => {
    const wording = String(value).trim();
    const key = wording.toLocaleLowerCase('en').replace(/\s+/g, ' ');
    const canonical = NOTE_ALIASES[key] || key;
    const uncertain = /\?|maybe|hint of|reminiscent|like\b/i.test(wording);
    return { source: wording, canonical: !uncertain && NOTES[canonical] ? canonical : null, categories: !uncertain ? NOTES[canonical] || [] : [], status: uncertain ? 'uncertain' : NOTES[canonical] ? 'mapped' : 'unmapped' };
  }) };
}

function canonicalProductUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid product URL');
  url.hash = '';
  // Keep identity-bearing query parameters; discard tracking and selected variant only.
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid|variant)$/.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}
function stableKey(...parts) { return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex'); }
function stableUuid(...parts) {
  const bytes = Buffer.from(stableKey(...parts).slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function normalizeProduct(product, sourceUrl) {
  const attributes = product.attributes || {};
  const variants = product.variants || (product.variant_prices || []).map(([title, price]) => ({ title, price }));
  if (!variants.length && product.default_price != null) variants.push({ title: 'default', price: product.default_price });
  const normalized = variants.map(v => ({
    ...v, source_id: v.source_id ?? v.id ?? null, title: v.title || 'default',
    weight_g: v.weight_g ?? parseWeightGrams(v.title),
    money: parseMoney(v.price, { currency: v.currency || product.variant_price_currency, locale: v.locale || product.price_locale }),
    availability: v.available === true ? 'in_stock' : v.available === false ? 'sold_out' : v.availability || 'unknown',
  }));
  return { ...product, original_title: product.original_title || product.name, display_title: displayTitle(product.name, attributes), variants: normalized,
    normalization_version: NORMALIZATION_VERSION, source_url: canonicalProductUrl(sourceUrl), tasting_notes: tastingNotes(attributes.flavor_notes) };
}

module.exports = { currencyCode, parseMoney, displayTitle, tastingNotes, canonicalProductUrl, stableKey, stableUuid, normalizeProduct, NORMALIZATION_VERSION };
