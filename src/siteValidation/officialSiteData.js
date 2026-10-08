const crypto = require('node:crypto');
const cheerio = require('cheerio');
const { canonicalHost, normalizeRecord, strictNameKey } = require('../directoryImport/core');
const { approveOfficialSiteRecord, identityEvidence, verifyAcceptedRecord } = require('./acceptance');

const EXTRACTION_SCHEMA_VERSION = 1;
const MAX_SNIPPET_LENGTH = 220;
const IDENTITY_TYPES = new Map([
  ['Organization', 3],
  ['LocalBusiness', 2],
  ['CafeOrCoffeeShop', 1],
]);
const SOCIAL_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com',
  'twitter.com', 'x.com', 'youtube.com', 'youtu.be',
]);
const ROASTING_PATTERNS = [
  ['roast_our_coffee', /\b(?:we|our team) roast (?:all of )?our (?:own )?coffee\b/i],
  ['freshly_roasted', /\bfreshly roasted coffee\b/i],
  ['roasted_to_order', /\broasted to order\b/i],
  ['our_roastery', /\bour roaster(?:y|ies)\b/i],
  ['french_roaster', /\b(?:torr[eé]facteur|torr[eé]faction|caf[eé] torr[eé]fi[eé])\b/i],
  ['spanish_roaster', /\b(?:tostador(?:a)? de caf[eé]|tostamos caf[eé])\b/i],
];

function cleanText(value, maximum = 2000) {
  if (value === null || value === undefined) return null;
  const result = String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
  return result ? result.slice(0, maximum) : null;
}

function scalarText(value, maximum = 2000) {
  return ['string', 'number'].includes(typeof value) ? cleanText(value, maximum) : null;
}

function boundedSnippet(value, matchIndex = 0, matchLength = 0) {
  const text = cleanText(value, 100000) || '';
  const start = Math.max(0, matchIndex - 70);
  const end = Math.min(text.length, matchIndex + matchLength + 70);
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
    .slice(0, MAX_SNIPPET_LENGTH);
}

function normalizeSchemaType(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => cleanText(entry, 200))
    .filter(Boolean)
    .map((entry) => entry.replace(/.*[#/]/, ''));
}

function safeHttpUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim(), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function pointerToken(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function collectJsonLdNodes($) {
  const nodes = [];
  $('script[type="application/ld+json"]').slice(0, 50).each((scriptIndex, element) => {
    const source = $(element).text().trim();
    if (!source || source.length > 200000) return;
    let parsed;
    try { parsed = JSON.parse(source); } catch { return; }
    const walk = (item, pointer, depth = 0) => {
      if (depth > 8 || nodes.length >= 500 || item === null || item === undefined) return;
      if (Array.isArray(item)) {
        item.slice(0, 200).forEach((entry, index) => walk(entry, `${pointer}/${index}`, depth + 1));
        return;
      }
      if (typeof item !== 'object') return;
      if (item['@type']) nodes.push({ item, pointer, scriptIndex });
      Object.entries(item).forEach(([key, entry]) => {
        if (entry && typeof entry === 'object') walk(entry, `${pointer}/${pointerToken(key)}`, depth + 1);
      });
    };
    walk(parsed, `/jsonld/${scriptIndex}`);
  });
  return nodes;
}

function provenance(kind, pointer, value, finalUrl, confidence = 'high') {
  return {
    source: 'official_site',
    sourceUrl: finalUrl,
    kind,
    pointer,
    confidence,
    snippet: boundedSnippet(value),
  };
}

function addressCountry(value) {
  if (typeof value === 'string') return cleanText(value, 100);
  if (value && typeof value === 'object') return cleanText(value.name || value['@id'], 100);
  return null;
}

function structuredAddress(value) {
  if (typeof value === 'string') return { address1: cleanText(value, 300) };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {
    address1: cleanText(value.streetAddress, 300),
    city: cleanText(value.addressLocality, 160),
    region: cleanText(value.addressRegion, 160),
    postal_code: cleanText(value.postalCode, 40),
    country: addressCountry(value.addressCountry),
  };
  const compact = Object.fromEntries(Object.entries(result).filter(([, entry]) => entry));
  return Object.keys(compact).length ? compact : null;
}

function socialUrl(value, baseUrl) {
  const url = safeHttpUrl(value, baseUrl);
  if (!url) return null;
  const host = canonicalHost(url);
  if (![...SOCIAL_HOSTS].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return null;
  return url;
}

function uniqueFacts(items, key = (item) => JSON.stringify(item)) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function roastingEvidence(sources, finalUrl) {
  const evidence = [];
  for (const source of sources) {
    const text = cleanText(source.text, 100000) || '';
    for (const [signal, pattern] of ROASTING_PATTERNS) {
      const match = pattern.exec(text);
      if (!match) continue;
      evidence.push({
        signal,
        strength: 'strong',
        excerpt: boundedSnippet(text, match.index, match[0].length),
        provenance: {
          source: 'official_site',
          sourceUrl: finalUrl,
          kind: source.kind,
          pointer: source.pointer,
        },
      });
    }
  }
  return uniqueFacts(evidence, (item) => `${item.signal}\0${item.provenance.pointer}`)
    .slice(0, 12);
}

function extractOfficialSiteData(html, finalUrl, options = {}) {
  const officialUrl = safeHttpUrl(finalUrl);
  if (!officialUrl) throw new Error('finalUrl must be an absolute HTTP(S) URL');
  const $ = cheerio.load(String(html || ''));
  const nodes = collectJsonLdNodes($);
  const identityNodes = nodes.map((node) => {
    const types = normalizeSchemaType(node.item['@type']);
    const priority = Math.max(0, ...types.map((type) => IDENTITY_TYPES.get(type) || 0));
    return { ...node, types, priority, name: scalarText(node.item.name, 160) };
  }).filter((node) => node.priority && node.name)
    .sort((a, b) => b.priority - a.priority || a.pointer.localeCompare(b.pointer));

  const distinctNames = new Map();
  identityNodes.forEach((node) => {
    const key = strictNameKey(node.name);
    if (key && !distinctNames.has(key)) distinctNames.set(key, node.name);
  });
  const ambiguities = [];
  if (distinctNames.size > 1) {
    ambiguities.push({
      field: 'name',
      reasonCode: 'multiple_schema_business_names',
      values: [...distinctNames.values()].slice(0, 20),
    });
  }

  const selectedNode = identityNodes[0] || null;
  let name = null;
  if (selectedNode && distinctNames.size === 1) {
    name = {
      value: selectedNode.name,
      confidence: 'high',
      schemaTypes: selectedNode.types,
      provenance: provenance('json_ld', `${selectedNode.pointer}/name`, selectedNode.name, officialUrl),
    };
  } else if (!selectedNode) {
    const siteName = cleanText($('meta[property="og:site_name"]').first().attr('content'), 160);
    const title = cleanText($('title').first().text(), 300);
    if (siteName) {
      name = { value: siteName, confidence: 'medium', schemaTypes: [], provenance: provenance('meta', 'meta[property="og:site_name"]', siteName, officialUrl, 'medium') };
    } else if (title) {
      name = { value: title, confidence: 'low', schemaTypes: [], provenance: provenance('html', 'title', title, officialUrl, 'low') };
    }
  }

  const node = selectedNode?.item || {};
  const nodePointer = selectedNode?.pointer || null;
  const telephone = scalarText(node.telephone, 100) || cleanText($('a[href^="tel:"]').first().attr('href')?.replace(/^tel:/i, ''), 100);
  const email = scalarText(node.email, 320)?.replace(/^mailto:/i, '') || cleanText($('a[href^="mailto:"]').first().attr('href')?.replace(/^mailto:/i, '').split('?')[0], 320);
  const address = structuredAddress(node.address) || (() => {
    const visible = cleanText($('address').first().text(), 300);
    return visible ? { address1: visible } : null;
  })();
  const geo = node.geo && typeof node.geo === 'object' ? node.geo : null;
  if (address && geo) {
    const lat = Number(geo.latitude);
    const lng = Number(geo.longitude);
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90) address.lat = lat;
    if (Number.isFinite(lng) && lng >= -180 && lng <= 180) address.lng = lng;
  }

  const socials = [];
  const sameAs = Array.isArray(node.sameAs) ? node.sameAs : node.sameAs ? [node.sameAs] : [];
  sameAs.forEach((value, index) => {
    const url = socialUrl(value, officialUrl);
    if (url) socials.push({ value: url, provenance: provenance('json_ld', `${nodePointer}/sameAs/${index}`, url, officialUrl) });
  });
  $('a[href]').slice(0, 500).each((_index, element) => {
    const url = socialUrl($(element).attr('href'), officialUrl);
    if (url) socials.push({ value: url, provenance: provenance('html', 'a[href]', url, officialUrl, 'medium') });
  });

  const canonical = safeHttpUrl($('link[rel~="canonical"]').first().attr('href'), officialUrl);
  const bodyText = cleanText($('body').clone().find('script,style,noscript,svg,template').remove().end().text(), 100000);
  const metaDescription = cleanText($('meta[name="description"]').first().attr('content') || $('meta[property="og:description"]').first().attr('content'), 2000);
  const evidenceSources = [];
  if (selectedNode) {
    for (const field of ['description', 'slogan']) {
      if (node[field]) evidenceSources.push({ kind: 'json_ld', pointer: `${nodePointer}/${field}`, text: node[field] });
    }
  }
  if (metaDescription) evidenceSources.push({ kind: 'meta', pointer: 'meta[description]', text: metaDescription });
  if (bodyText) evidenceSources.push({ kind: 'html', pointer: 'body', text: bodyText });

  const contact = {};
  const contactProvenance = {};
  if (telephone) {
    contact.phone = telephone;
    contactProvenance.phone = provenance(node.telephone ? 'json_ld' : 'html', node.telephone ? `${nodePointer}/telephone` : 'a[href^="tel:"]', telephone, officialUrl);
  }
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    contact.email = email;
    contactProvenance.email = provenance(node.email ? 'json_ld' : 'html', node.email ? `${nodePointer}/email` : 'a[href^="mailto:"]', email, officialUrl);
  }
  const uniqueSocials = uniqueFacts(socials, (item) => item.value);
  if (uniqueSocials.length) {
    contact.socials = uniqueSocials.map((item) => item.value).slice(0, 20);
    contactProvenance.socials = uniqueSocials.map((item) => item.provenance).slice(0, 20);
  }

  return {
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    extractedAt: options.checkedAt || new Date().toISOString(),
    sourceKind: 'official_site_single_page',
    finalUrl: officialUrl,
    finalHost: canonicalHost(officialUrl),
    declaredCanonical: canonical && canonicalHost(canonical) === canonicalHost(officialUrl) ? canonical : null,
    facts: {
      name,
      officialWebsite: {
        value: officialUrl,
        confidence: 'high',
        provenance: provenance('network', 'final_url', officialUrl, officialUrl),
      },
      contact: Object.keys(contact).length ? contact : null,
      address,
    },
    fieldProvenance: {
      contact: contactProvenance,
      address: address ? provenance(node.address ? 'json_ld' : 'html', node.address ? `${nodePointer}/address` : 'address', JSON.stringify(address), officialUrl) : null,
    },
    roastingEvidence: roastingEvidence(evidenceSources, officialUrl),
    ambiguities,
    legalReview: {
      status: 'requires_review',
      note: 'This artifact records bounded factual observations from one official page and source provenance. It does not determine copyright, database-right, privacy, or publication obligations.',
    },
  };
}

function officialSourceId(finalUrl) {
  return `official-site-${crypto.createHash('sha256').update(finalUrl).digest('hex').slice(0, 32)}`;
}

function convertOfficialSiteRecord(record, options = {}) {
  verifyAcceptedRecord(record, options);
  const validation = record.validation;
  const extraction = validation?.officialSite;
  if (!extraction || extraction.schemaVersion !== EXTRACTION_SCHEMA_VERSION) throw new Error('approved record has no official-site extraction');
  if (extraction.finalUrl !== validation.finalUrl || extraction.finalHost !== validation.finalHost) throw new Error('official-site extraction does not match the validated final URL');
  if (extraction.ambiguities?.length) throw new Error('official-site facts contain unresolved ambiguities');
  const nameFact = extraction.facts?.name;
  if (!nameFact?.value || nameFact.confidence !== 'high' || nameFact.provenance?.kind !== 'json_ld') {
    throw new Error('official site lacks a high-confidence schema business name');
  }
  const extractedIdentity = identityEvidence(nameFact.value, validation.page?.title, validation.finalHost);
  if (!extractedIdentity) throw new Error('official schema name does not match the validated page identity');
  if (!(extraction.roastingEvidence || []).some((item) => item.strength === 'strong')) {
    throw new Error('official-site extraction lacks explicit roasting evidence');
  }

  const finalUrl = extraction.finalUrl;
  const sourceMetadata = record.source_metadata || record.sourceMetadata || {};
  const candidate = {
    source_profile: finalUrl,
    source_record_id: officialSourceId(finalUrl),
    source_metadata: {
      source_kind: 'official_site_single_page_observation',
      source_url: finalUrl,
      fetched_at: validation.checkedAt,
      extraction_schema_version: extraction.schemaVersion,
      property_provenance: {
        name: nameFact.provenance,
        official_website: extraction.facts.officialWebsite.provenance,
        contact: extraction.fieldProvenance?.contact || {},
        location: extraction.fieldProvenance?.address || null,
        roasting_evidence: extraction.roastingEvidence,
      },
      discovery_lineage: {
        provider: sourceMetadata.provider || null,
        release: sourceMetadata.release || null,
        source_profile: record.source_profile || record.sourceProfile || null,
        source_record_id: record.source_record_id || record.sourceRecordId || null,
        note: 'Discovery identifiers only. Name, website, contact, and location in this candidate come solely from the official-site observation above.',
      },
      legal_review: extraction.legalReview,
    },
    name: nameFact.value,
    official_website: finalUrl,
    contact: extraction.facts.contact || undefined,
    location: extraction.facts.address || undefined,
    official_site_validation: {
      validationKey: validation.key,
      checkedAt: validation.checkedAt,
      finalUrl: validation.finalUrl,
      finalHost: validation.finalHost,
      httpStatus: validation.httpStatus,
      robots: validation.robots,
      classification: validation.classification,
      plausibleRoaster: validation.plausibleRoaster,
      identity: extractedIdentity,
      roastingEvidence: extraction.roastingEvidence,
    },
  };
  if (!candidate.contact) delete candidate.contact;
  if (!candidate.location) delete candidate.location;
  normalizeRecord(candidate);
  return approveOfficialSiteRecord(candidate, {
    upstreamAcceptanceHash: record.validation_acceptance.hash,
    discoveryValidationKey: validation.key,
  });
}

module.exports = {
  EXTRACTION_SCHEMA_VERSION,
  MAX_SNIPPET_LENGTH,
  convertOfficialSiteRecord,
  extractOfficialSiteData,
  officialSourceId,
};
