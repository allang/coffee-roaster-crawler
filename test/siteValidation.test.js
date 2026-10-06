const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RateLimiter,
  assertSafePublicUrl,
  candidateKey,
  classifyHtml,
  genericHostKind,
  requestFollowingRedirects,
  robotsAllows,
  validateCandidate,
} = require('../src/siteValidation/core');
const { readCheckpoint, sharedHostGroups, shouldRetry } = require('../src/siteValidation/cli');
const { acceptRecord, evaluateValidation, verifyAcceptedRecord } = require('../src/siteValidation/acceptance');
const { convertOfficialSiteRecord, extractOfficialSiteData, MAX_SNIPPET_LENGTH } = require('../src/siteValidation/officialSiteData');
const { assertApprovedRecords } = require('../src/directoryImport/cli');
const { normalizeRecord } = require('../src/directoryImport/core');
const { cleanProjection, verifyLedgerRecord, verifyLicenseAcceptedRecord } = require('../src/directoryImport/licenseAcceptance');
const { stableStringify } = require('../src/directoryImport/core');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const candidate = {
  name: 'Acme Coffee',
  official_website: 'https://coffee.example/',
  source_profile: 'https://docs.overturemaps.org/guides/places/',
  source_record_id: 'place-1',
};

test('classifier distinguishes strong, weak, parked, and ambiguous pages', () => {
  assert.equal(classifyHtml('<html><body>We roast our own coffee every week.</body></html>', candidate).classification, 'likely_roaster');
  assert.equal(classifyHtml('<html><body>Specialty coffee, single-origin coffee beans, whole bean. Add to cart.</body></html>', candidate).classification, 'possible_roaster');
  assert.equal(classifyHtml('<html><body>This domain name is for sale.</body></html>', candidate).classification, 'unlikely_roaster');
  assert.equal(classifyHtml('<html><body>Welcome to Acme.</body></html>', candidate).classification, 'needs_review');
  assert.equal(classifyHtml('<html><body>Our cafe serves breakfast and lunch. See the food menu.</body></html>', candidate).classification, 'cafe_only');
  assert.equal(classifyHtml('<html><body>Our coffee roastery has permanently closed.</body></html>', candidate).classification, 'permanently_closed');
  assert.equal(classifyHtml('<html><body>Our coffee roastery.</body></html>', candidate).reasonCode, 'explicit_roasting_evidence');
});

test('candidate name alone is never treated as site evidence', () => {
  assert.equal(classifyHtml('<html><body>Welcome.</body></html>', { name: 'Acme Coffee Roasters' }).classification, 'needs_review');
});

const officialHtml = `<!doctype html>
<html>
  <head>
    <title>Acme Coffee LLC — Small-batch coffee</title>
    <meta property="og:site_name" content="A fallback name that must not win">
    <meta name="description" content="We roast our own coffee every week in Portland.">
    <link rel="canonical" href="https://www.coffee.example/">
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Acme Coffee",
        "description": "We roast our own coffee in small batches.",
        "telephone": "+1-503-555-0199",
        "email": "hello@coffee.example",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "10 Bean Street",
          "addressLocality": "Portland",
          "addressRegion": "OR",
          "postalCode": "97205",
          "addressCountry": "US"
        },
        "sameAs": ["https://www.instagram.com/acmecoffee"]
      }
    </script>
  </head>
  <body><p>Our roastery ships freshly roasted coffee.</p></body>
</html>`;

test('official-site extractor prefers recognized schema facts and bounds provenance', () => {
  const extraction = extractOfficialSiteData(officialHtml, 'https://www.coffee.example/landing', { checkedAt: '2026-08-10T12:00:00.000Z' });
  assert.equal(extraction.facts.name.value, 'Acme Coffee');
  assert.equal(extraction.facts.name.confidence, 'high');
  assert.equal(extraction.facts.name.provenance.kind, 'json_ld');
  assert.equal(extraction.facts.officialWebsite.value, 'https://www.coffee.example/landing');
  assert.equal(extraction.facts.contact.phone, '+1-503-555-0199');
  assert.equal(extraction.facts.contact.email, 'hello@coffee.example');
  assert.deepEqual(extraction.facts.contact.socials, ['https://www.instagram.com/acmecoffee']);
  assert.deepEqual(extraction.facts.address, {
    address1: '10 Bean Street', city: 'Portland', region: 'OR', postal_code: '97205', country: 'US',
  });
  assert.equal(extraction.ambiguities.length, 0);
  assert.equal(extraction.legalReview.status, 'requires_review');
  assert.ok(extraction.roastingEvidence.some((item) => item.signal === 'roast_our_coffee'));
  for (const item of extraction.roastingEvidence) assert.ok(item.excerpt.length <= MAX_SNIPPET_LENGTH);
});

test('conflicting schema business names remain ambiguous instead of being selected', () => {
  const html = `<title>Shared Site</title>
    <script type="application/ld+json">{"@graph":[
      {"@type":"Organization","name":"First Coffee"},
      {"@type":"LocalBusiness","name":"Second Coffee"}
    ]}</script><body>We roast our own coffee.</body>`;
  const extraction = extractOfficialSiteData(html, 'https://coffee.example/');
  assert.equal(extraction.facts.name, null);
  assert.equal(extraction.ambiguities[0].reasonCode, 'multiple_schema_business_names');
});

test('generic directory, social, and aggregator hosts are identified deterministically', () => {
  assert.equal(genericHostKind('www.instagram.com'), 'social_profile');
  assert.equal(genericHostKind('m.yelp.com'), 'business_directory');
  assert.equal(genericHostKind('linktr.ee'), 'link_aggregator');
  assert.equal(genericHostKind('coffee.example'), null);
});

test('candidate keys are stable and include source identity', () => {
  assert.equal(candidateKey(candidate, 0), candidateKey({ ...candidate }, 99));
  assert.notEqual(candidateKey(candidate, 0), candidateKey({ ...candidate, source_record_id: 'place-2' }, 0));
});

test('shared canonical hosts are identified before any site validation', () => {
  const groups = sharedHostGroups([
    candidate,
    { ...candidate, source_record_id: 'place-2', official_website: 'https://www.coffee.example/location-2' },
    { ...candidate, source_record_id: 'place-3', official_website: 'https://other.example/' },
  ]);
  assert.deepEqual(groups.get('coffee.example'), [0, 1]);
  assert.equal(groups.has('other.example'), false);
});

test('robots rules use the longest match and prefer a specific agent', () => {
  const text = `User-agent: *\nDisallow: /\n\nUser-agent: EveryCoffeeCatalogValidator\nDisallow: /private\nAllow: /private/catalog\n`;
  assert.equal(robotsAllows(text, '/', 'EveryCoffeeCatalogValidator').allowed, true);
  assert.equal(robotsAllows(text, '/private/file', 'EveryCoffeeCatalogValidator').allowed, false);
  assert.equal(robotsAllows(text, '/private/catalog/coffee', 'EveryCoffeeCatalogValidator').allowed, true);
});

test('network guard blocks Roast Local, private hosts, and private redirects', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(assertSafePublicUrl('https://roastlocal.com/oregon', publicLookup), /explicitly prohibited/);
  await assert.rejects(assertSafePublicUrl('https://www.roastlocal.com/', publicLookup), /explicitly prohibited/);
  await assert.rejects(assertSafePublicUrl('http://127.0.0.1/', publicLookup), /Private or reserved/);
  await assert.rejects(assertSafePublicUrl('http://[::1]/', publicLookup), /Private or reserved/);
  await assert.rejects(assertSafePublicUrl('http://[::ffff:7f00:1]/', publicLookup), /Private or reserved/);
  await assert.doesNotReject(assertSafePublicUrl('https://coffee.example/', publicLookup));
});

test('live transport pins the validated address and cannot perform a private second resolution', async () => {
  let dnsCalls = 0;
  const rebindingLookup = async () => {
    dnsCalls += 1;
    return dnsCalls === 1
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }];
  };
  let socketAddress;
  let tlsServername;
  let requestUsedFreshSocket;
  const requestFactory = (url, options, callback) => {
    const request = new EventEmitter();
    request.end = () => {
      tlsServername = options.servername;
      requestUsedFreshSocket = options.agent === false && options.rejectUnauthorized !== false;
      options.lookup(url.hostname, { all: false }, (error, address) => {
        assert.ifError(error);
        socketAddress = address;
        const response = Readable.from(['safe response']);
        response.statusCode = 200;
        response.headers = { 'content-type': 'text/plain' };
        callback(response);
      });
    };
    return request;
  };
  const response = await requestFollowingRedirects('https://coffee.example/', {
    lookup: rebindingLookup,
    limiter: new RateLimiter({ globalDelayMs: 0, perHostDelayMs: 0 }),
    timeoutMs: 1000,
    maxBytes: 1024,
    maxRedirects: 0,
    userAgent: 'EveryCoffeeCatalogValidator/1.0',
    requestFactory,
  });
  assert.equal(response.status, 200);
  assert.equal(dnsCalls, 1);
  assert.equal(socketAddress, '93.184.216.34');
  assert.equal(tlsServername, 'coffee.example');
  assert.equal(requestUsedFreshSocket, true);
});

test('pinned transport revalidates a redirect before opening the next socket', async () => {
  let dnsCalls = 0;
  const lookup = async (hostname) => {
    dnsCalls += 1;
    return hostname === 'one.example'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }];
  };
  let requests = 0;
  const requestFactory = (_url, _options, callback) => {
    requests += 1;
    const request = new EventEmitter();
    request.end = () => {
      const response = Readable.from([]);
      response.statusCode = 302;
      response.headers = { location: 'https://two.example/' };
      callback(response);
    };
    return request;
  };
  await assert.rejects(requestFollowingRedirects('https://one.example/', {
    lookup,
    limiter: new RateLimiter({ globalDelayMs: 0, perHostDelayMs: 0 }),
    timeoutMs: 1000,
    maxBytes: 1024,
    maxRedirects: 2,
    userAgent: 'EveryCoffeeCatalogValidator/1.0',
    requestFactory,
  }), /private or reserved/i);
  assert.equal(dnsCalls, 2);
  assert.equal(requests, 1);
});

test('validator honors robots across redirects and records final-site evidence', async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    const value = url.toString();
    requested.push(value);
    if (value === 'https://coffee.example/robots.txt' || value === 'https://www.coffee.example/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    if (value === 'https://coffee.example/') return new Response('', { status: 301, headers: { location: 'https://www.coffee.example/' } });
    if (value === 'https://www.coffee.example/') return new Response('<html><title>Acme</title><body>We are a small-batch coffee roaster.</body></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    throw new Error(`Unexpected URL ${value}`);
  };
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const result = await validateCandidate(candidate, 0, {
    fetch: fakeFetch,
    lookup,
    limiter: new RateLimiter({ globalDelayMs: 0, perHostDelayMs: 0 }),
    robotsCache: new Map(),
    timeoutMs: 1000,
  });
  assert.equal(result.classification, 'likely_roaster');
  assert.equal(result.finalUrl, 'https://www.coffee.example/');
  assert.equal(result.requestedHost, 'coffee.example');
  assert.equal(result.finalHost, 'coffee.example');
  assert.equal(result.sourceRecordId, 'place-1');
  assert.equal(result.officialSite.finalUrl, 'https://www.coffee.example/');
  assert.equal(result.officialSite.sourceKind, 'official_site_single_page');
  assert.deepEqual(result.redirectChain.map((step) => step.status), [301, 200]);
  assert.deepEqual(requested, [
    'https://coffee.example/robots.txt',
    'https://coffee.example/',
    'https://www.coffee.example/robots.txt',
    'https://www.coffee.example/',
  ]);
});

test('validator rejects a social profile without requesting it', async () => {
  let fetched = false;
  const result = await validateCandidate({ ...candidate, official_website: 'https://instagram.com/acme' }, 0, {
    fetch: async () => { fetched = true; throw new Error('must not fetch'); },
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  assert.equal(result.classification, 'unsupported_host');
  assert.equal(result.reasonCode, 'generic_directory_or_social_host');
  assert.equal(fetched, false);
});

test('validator stops when robots disallows the official path', async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(url.toString());
    return new Response('User-agent: *\nDisallow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } });
  };
  const result = await validateCandidate(candidate, 0, {
    fetch: fakeFetch,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    limiter: new RateLimiter({ globalDelayMs: 0, perHostDelayMs: 0 }),
    robotsCache: new Map(),
    timeoutMs: 1000,
  });
  assert.equal(result.classification, 'robots_blocked');
  assert.deepEqual(requested, ['https://coffee.example/robots.txt']);
});

test('checkpoint reader resumes complete rows and ignores only a partial final row', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-site-validation-'));
  const file = path.join(directory, 'checkpoint.ndjson');
  try {
    fs.writeFileSync(file, '{"validation":{"key":"done","classification":"likely_roaster"}}\n{"validation":');
    const checkpoint = readCheckpoint(file);
    assert.equal(checkpoint.size, 1);
    assert.equal(checkpoint.get('done').validation.classification, 'likely_roaster');
    assert.equal(shouldRetry(checkpoint.get('done')), false);
    assert.equal(shouldRetry({ validation: { classification: 'unreachable' } }), true);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

function validatedRecord(overrides = {}) {
  const record = {
    ...candidate,
    validation: {
      key: candidateKey(candidate, 0),
      inputIndex: 0,
      sourceRecordId: candidate.source_record_id,
      name: candidate.name,
      requestedUrl: candidate.official_website,
      requestedHost: 'coffee.example',
      finalUrl: candidate.official_website,
      finalHost: 'coffee.example',
      checkedAt: '2026-08-10T12:00:00.000Z',
      httpStatus: 200,
      contentType: 'text/html; charset=utf-8',
      robots: { status: 200, allowed: true },
      classification: 'likely_roaster',
      plausibleRoaster: true,
      evidence: [{ signal: 'roast_our_coffee', strength: 'strong', excerpt: 'We roast our own coffee.' }],
      page: { title: 'Acme Coffee — Home', description: 'Fresh coffee' },
      error: null,
    },
  };
  return { ...record, ...overrides, validation: { ...record.validation, ...(overrides.validation || {}) } };
}

test('acceptance filter approves only fresh same-host explicit roasting plus title identity', () => {
  const now = new Date('2026-08-10T13:00:00.000Z');
  const result = acceptRecord(validatedRecord(), { now });
  assert.equal(result.accepted, true);
  assert.equal(result.decision.reasonCode, 'accepted_v1');
  assert.equal(verifyAcceptedRecord(result.record, { now }), true);
  assert.throws(() => assertApprovedRecords([result.record], { now }), /license ledger and manifest are required/);
  const independent = acceptRecord(validatedRecord({ source_profile: 'https://acme.example/source-record/place-1' }), { now });
  assert.equal(assertApprovedRecords([independent.record], { now }), true);
});

test('offline converter emits only official-page facts and preserves discovery as lineage', () => {
  const now = new Date('2026-08-10T13:00:00.000Z');
  const extraction = extractOfficialSiteData(officialHtml, candidate.official_website, { checkedAt: '2026-08-10T12:00:00.000Z' });
  const discovered = validatedRecord({
    name: 'Acme Coffee LLC',
    contact: { phone: '+1-000-OVERTURE' },
    location: { address1: 'Overture-only address', city: 'Wrong City' },
    source_metadata: { provider: 'Overture Maps Foundation', release: '2026-06-17.0' },
    validation: {
      name: 'Acme Coffee LLC',
      page: { title: 'Acme Coffee LLC — Small-batch coffee', description: 'We roast our own coffee.' },
      officialSite: extraction,
    },
  });
  const approvedDiscovery = acceptRecord(discovered, { now }).record;
  const converted = convertOfficialSiteRecord(approvedDiscovery, { now });
  assert.equal(converted.name, 'Acme Coffee');
  assert.equal(converted.official_website, candidate.official_website);
  assert.equal(converted.source_profile, candidate.official_website);
  assert.equal(converted.contact.phone, '+1-503-555-0199');
  assert.equal(converted.location.address1, '10 Bean Street');
  assert.equal(converted.location.city, 'Portland');
  assert.equal(converted.source_metadata.source_kind, 'official_site_single_page_observation');
  assert.equal(converted.source_metadata.discovery_lineage.provider, 'Overture Maps Foundation');
  assert.equal(converted.source_metadata.legal_review.status, 'requires_review');
  assert.equal(JSON.stringify(converted).includes('Overture-only address'), false);
  assert.equal(JSON.stringify(converted).includes('+1-000-OVERTURE'), false);
  assert.equal(verifyAcceptedRecord(converted, { now }), true);
  assert.throws(() => verifyAcceptedRecord({ ...converted, name: 'Tampered Name' }, { now }), /hash mismatch/);
  assert.equal(assertApprovedRecords([converted], { now }), true);
  assert.doesNotThrow(() => normalizeRecord(converted));
});

test('offline converter refuses ambiguous or non-schema official identities', () => {
  const now = new Date('2026-08-10T13:00:00.000Z');
  const ambiguous = extractOfficialSiteData(`<title>Acme Coffee</title><script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Acme Coffee"},{"@type":"LocalBusiness","name":"Other Coffee"}]}</script><body>We roast our own coffee.</body>`, candidate.official_website, { checkedAt: '2026-08-10T12:00:00.000Z' });
  const approvedAmbiguous = acceptRecord(validatedRecord({ validation: { officialSite: ambiguous } }), { now }).record;
  assert.throws(() => convertOfficialSiteRecord(approvedAmbiguous, { now }), /unresolved ambiguities/);

  const metaOnly = extractOfficialSiteData(`<title>Acme Coffee</title><meta property="og:site_name" content="Acme Coffee"><body>We roast our own coffee.</body>`, candidate.official_website, { checkedAt: '2026-08-10T12:00:00.000Z' });
  const approvedMetaOnly = acceptRecord(validatedRecord({ validation: { officialSite: metaOnly } }), { now }).record;
  assert.throws(() => convertOfficialSiteRecord(approvedMetaOnly, { now }), /high-confidence schema business name/);
});

test('acceptance metadata detects candidate or validation tampering', () => {
  const now = new Date('2026-08-10T13:00:00.000Z');
  const approved = acceptRecord(validatedRecord(), { now }).record;
  assert.throws(() => verifyAcceptedRecord({ ...approved, name: 'Different Coffee' }, { now }), /hash mismatch/);
  assert.throws(() => assertApprovedRecords([validatedRecord()]), /not approved/);
});

test('cross-host redirects and stale validation always require manual review', () => {
  const crossHost = evaluateValidation(validatedRecord({ validation: { finalUrl: 'https://new.example/', finalHost: 'new.example' } }), { now: new Date('2026-08-10T13:00:00.000Z') });
  assert.equal(crossHost.disposition, 'manual');
  assert.equal(crossHost.reasonCode, 'cross_host_redirect');
  const stale = evaluateValidation(validatedRecord(), { now: new Date('2026-08-20T13:00:00.000Z') });
  assert.equal(stale.disposition, 'manual');
  assert.equal(stale.reasonCode, 'stale_validation');
});

test('bare roaster mentions and unconfirmed candidate identity are never auto-approved', () => {
  const now = new Date('2026-08-10T13:00:00.000Z');
  const bareMention = evaluateValidation(validatedRecord({ validation: { evidence: [{ signal: 'coffee_roaster', strength: 'strong', excerpt: 'Coffee from local coffee roasters.' }] } }), { now });
  assert.equal(bareMention.disposition, 'manual');
  assert.equal(bareMention.reasonCode, 'weak_roasting_evidence');
  const wrongIdentity = evaluateValidation(validatedRecord({ validation: { page: { title: 'Different Brand Coffee', description: null } } }), { now });
  assert.equal(wrongIdentity.disposition, 'manual');
  assert.equal(wrongIdentity.reasonCode, 'candidate_identity_unconfirmed');
});

test('negative validator outcomes are rejected, not promoted to manual acceptance', () => {
  const result = evaluateValidation(validatedRecord({ validation: { classification: 'permanently_closed', plausibleRoaster: false } }), { now: new Date('2026-08-10T13:00:00.000Z') });
  assert.equal(result.disposition, 'reject');
  assert.equal(result.reasonCode, 'validator_permanently_closed');
});

function licensedOvertureFixture(productionEligible = true) {
  const raw = validatedRecord({
    source_metadata: { provider: 'Overture Maps Foundation' },
  });
  const projection = cleanProjection(raw);
  const core = {
    schema_version: 1,
    rule_version: 'overture-places-property-license-v1',
    canonicalization: 'json-utf8-sort-keys-no-whitespace-unescaped-unicode-v1',
    release: '2026-06-17.0',
    row_identity: { source_record_id: raw.source_record_id, name: raw.name, official_website: raw.official_website },
    normalized_import_projection: projection,
    normalized_import_projection_sha256: crypto.createHash('sha256').update(stableStringify(projection)).digest('hex'),
    selected_property_paths: ['/names/primary', '/websites/0'],
    governing_sources: [
      { target_path: '/names/primary', source_property: '', dataset: 'AllThePlaces', license: 'CC0-1.0', source_record_id: 'source-1' },
      { target_path: '/websites/0', source_property: '', dataset: 'AllThePlaces', license: 'CC0-1.0', source_record_id: 'source-1' },
    ],
    used_licenses: ['CC0-1.0'],
    license_artifacts: { 'CC0-1.0': [{ file: 'LICENSE-CC0-1.0.txt', sha256: 'b'.repeat(64), source_url: 'https://creativecommons.org/publicdomain/zero/1.0/' }] },
    data_gate_passed: true,
    local_license_artifacts_verified: true,
    public_redistribution_ready: productionEligible,
    production_eligible: productionEligible,
  };
  const ledger = { ...core, acceptance_sha256: crypto.createHash('sha256').update(stableStringify(core)).digest('hex') };
  raw.source_metadata.license_acceptance = {
    schema_version: 1,
    rule_version: core.rule_version,
    canonicalization: core.canonicalization,
    acceptance_sha256: ledger.acceptance_sha256,
    ledger_file: 'ledger.ndjson',
    data_gate_passed: true,
    public_redistribution_ready: productionEligible,
    production_eligible: productionEligible,
  };
  const accepted = acceptRecord(raw, { now: new Date('2026-08-10T13:00:00.000Z') }).record;
  return { accepted, context: { byId: new Map([[raw.source_record_id, ledger]]), ledgerFile: 'ledger.ndjson' }, ledger };
}

test('Overture imports require both tamper-evident site and production-eligible license acceptance', () => {
  const fixture = licensedOvertureFixture(true);
  assert.equal(verifyLedgerRecord(fixture.ledger), true);
  assert.equal(verifyLicenseAcceptedRecord(fixture.accepted, fixture.context), true);
  assert.equal(assertApprovedRecords([fixture.accepted], { licenseAcceptance: fixture.context, now: new Date('2026-08-10T13:00:00.000Z') }), true);
  const ineligible = licensedOvertureFixture(false);
  assert.throws(() => verifyLicenseAcceptedRecord(ineligible.accepted, ineligible.context), /not production-eligible/);
  assert.throws(() => assertApprovedRecords([fixture.accepted], { now: new Date('2026-08-10T13:00:00.000Z') }), /license ledger and manifest are required/);
});

test('license acceptance binds every imported value to the reviewed ledger projection', () => {
  const fixture = licensedOvertureFixture(true);
  const tampered = { ...fixture.accepted, name: 'Tampered Coffee' };
  assert.throws(() => verifyLicenseAcceptedRecord(tampered, fixture.context), /identity|projection/);
  const brokenLedger = { ...fixture.ledger, governing_sources: [] };
  assert.throws(() => verifyLedgerRecord(brokenLedger), /property-level governing sources/);
});
