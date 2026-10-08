'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertAllowedUrl, installLegalGuard, isLegalPath } = require('./legal-guard');
const { parseArgs, parseTargets, run, selectTarget } = require('./targeted-crawl');

function listen(server) { return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function close(server) { server.closeAllConnections?.(); return new Promise((resolve) => server.close(resolve)); }

test('legal guard blocks actual direct, encoded, redirect, CONNECT-proxy and forward-proxy requests before forbidden receipt', async () => {
  const received = [];
  const proxyReceived = [];
  const nativeRequest = http.request;
  const origin = http.createServer((req, res) => {
    received.push(req.url);
    if (req.url.startsWith('/jump/')) {
      res.writeHead(302, { location: '/%2570rivacy-policy?secret=never-log-me' }); res.end();
    } else if (req.url.startsWith('/allowed-jump/')) {
      res.writeHead(302, { location: '/products/allowed-redirect' }); res.end();
    } else { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); }
  });
  const originPort = await listen(origin);
  const sockets = new Set();
  const proxy = http.createServer((req, res) => {
    proxyReceived.push({ kind: 'forward', target: req.url });
    const target = new URL(req.url);
    const upstream = nativeRequest(target, { method: req.method, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  proxy.on('connect', (req, client, head) => {
    proxyReceived.push({ kind: 'connect', target: req.url });
    const [host, port] = req.url.split(':');
    const upstream = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
    sockets.add(client); sockets.add(upstream);
    client.on('close', () => { sockets.delete(client); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
  });
  const proxyPort = await listen(proxy);
  const events = [];
  const guard = installLegalGuard({ onEvent: (event) => events.push(event) });
  try {
    // Require Axios after guard installation, as the production runner does.
    const axios = require('axios');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const connectAgent = new HttpsProxyAgent(`http://127.0.0.1:${proxyPort}`);
    const root = `http://127.0.0.1:${originPort}`;
    const modes = [
      ['direct', { proxy: false }],
      ['connect', { proxy: false, httpAgent: connectAgent }],
      ['forward', { proxy: { protocol: 'http', host: '127.0.0.1', port: proxyPort } }],
    ];
    for (const [mode, config] of modes) {
      assert.equal((await axios.get(`${root}/products/${mode}`, config)).data, 'ok');
      assert.equal((await axios.get(`${root}/allowed-jump/${mode}`, config)).data, 'ok');
      for (const forbidden of ['/terms', '/pages/legal/disclaimer', '/%2574erms-and-conditions', '/policies/privacy-policy', '/cookies', '/index.php?page=privacy']) {
        const beforeOrigin = received.length;
        const beforeProxy = proxyReceived.length;
        await assert.rejects(axios.get(`${root}${forbidden}?token=never-log-me`, config));
        assert.equal(received.length, beforeOrigin, `forbidden ${mode} reached origin`);
        assert.equal(proxyReceived.length, beforeProxy, `forbidden ${mode} reached proxy`);
      }
      const before = received.length;
      await assert.rejects(axios.get(`${root}/jump/${mode}`, config));
      assert.equal(received.length, before + 1, `redirect ${mode} dispatched forbidden hop`);
      assert.equal(received.at(-1), `/jump/${mode}`);
    }
    assert.equal(await (await fetch(`${root}/products/fetch`)).text(), 'ok');
    assert.equal(await (await fetch(`${root}/allowed-jump/fetch`)).text(), 'ok');
    await assert.rejects(fetch(`${root}/%2574erms`));
    const beforeFetchRedirect = received.length;
    await assert.rejects(fetch(`${root}/jump/fetch`));
    assert.equal(received.length, beforeFetchRedirect + 1);
    assert.throws(() => http.get(`${root}/privacy`), { code: 'ECLEGALBLOCK' });
    const https = require('node:https');
    assert.throws(() => https.get('https://127.0.0.1:1/%2574erms'), { code: 'ECLEGALBLOCK' });
    assert.equal(received.some((url) => isLegalPath(url)), false);
    assert.equal(JSON.stringify(events).includes('never-log-me'), false);
    assert.equal(events.some((event) => event.url.includes('?')), false);
    assert.ok(events.filter((event) => event.disposition === 'blocked').length >= 25);
    assert.equal(guard.stats.prohibitedRequestsSent, 0);
    connectAgent.destroy();
  } finally {
    guard.uninstall();
    for (const socket of sockets) socket.destroy();
    await close(proxy); await close(origin);
  }
});

test('legal normalization and clean catalog API paths', () => {
  for (const value of ['/terms', '/%74erms', '/%2574erms', '/foo/%255cterms', '/TERMS.HTML', '/pages/legal-notice', '/privacy_policy', '/cookies/accept', '/data-protection', '/mentions-legales', '/impressum', '/foo/../terms']) {
    assert.throws(() => assertAllowedUrl(`https://coffee.example${value}`), { code: 'ECLEGALBLOCK' });
  }
  for (const value of ['/products/coffee', '/rest/v1/entity_source_ids', '/rest/v1/entity_roles', '/v1/chat/completions', '/api/v2/proxy/list/']) assert.doesNotThrow(() => assertAllowedUrl(`https://example.test${value}?apikey=never-log-me`));
  assert.throws(() => assertAllowedUrl('https://user:password@example.test/terms?secret=abc'), (error) => !/password|secret|abc/.test(error.message));
});

test('only exact configured internal blacklist table bypasses the legal path rule', () => {
  const https = require('node:https');
  const original = https.request;
  let dispatched = 0;
  // Stub transport proves dispatch decisions without contacting a database.
  https.request = () => { dispatched += 1; return { end() { return this; } }; };
  const guard = installLegalGuard({ internalDataOrigin: 'https://owned.supabase.co' });
  try {
    https.get('https://owned.supabase.co/rest/v1/crawl_blacklist_terms?select=term&enabled=eq.true');
    assert.equal(dispatched, 1);
    for (const url of [
      'https://external.example/rest/v1/crawl_blacklist_terms',
      'https://another.supabase.co/rest/v1/crawl_blacklist_terms',
      'https://owned.supabase.co/terms',
      'https://owned.supabase.co/rest/v1/terms',
      'https://owned.supabase.co/rest/v1/crawl_blacklist_terms/extra',
      'https://owned.supabase.co/rest/v1/%63rawl_blacklist_terms',
      'https://owned.supabase.co/rest/v1/crawl_blacklist_terms?page=terms',
    ]) assert.throws(() => https.get(url), { code: 'ECLEGALBLOCK' });
    assert.equal(dispatched, 1);
    assert.equal(guard.stats.blocked, 7);
  } finally { guard.uninstall(); https.request = original; }
});

test('target selection requires identity and provenance and honors active, disabled, completed and retry state', () => {
  const entityId = '00000000-0000-4000-8000-000000000001';
  const [target] = parseTargets(JSON.stringify({ entity_id: entityId, website_url: 'https://coffee.example/', source_ids: ['123'] }));
  const base = { entities: [{ id: entityId, website_url: 'https://coffee.example' }], roles: [{ entity_id: entityId, role: 'roaster' }], sourceIds: [{ entity_id: entityId, source: 'my_coffee_explorer', source_id: '123' }], crawlStates: [], runs: [] };
  assert.equal(selectTarget(target, base).eligible, true);
  assert.equal(selectTarget(target, { ...base, roles: [] }).reason, 'roaster_role_missing');
  assert.equal(selectTarget(target, { ...base, sourceIds: [] }).reason, 'verified_source_id_missing');
  assert.equal(selectTarget(target, { ...base, entities: [{ id: entityId, website_url: 'https://different.example' }] }).reason, 'website_mismatch');
  assert.equal(selectTarget(target, { ...base, crawlStates: [{ entity_id: entityId, allow_crawl: false }] }).reason, 'crawl_disabled');
  assert.equal(selectTarget(target, { ...base, runs: [{ entity_id: entityId, status: 'running', started_at: '2020-01-01' }] }).reason, 'active_crawl_exists');
  assert.equal(selectTarget(target, { ...base, runs: [{ entity_id: entityId, status: 'completed', finished_at: new Date().toISOString() }] }).reason, 'completed_within_24_hours');
  const checkpoint = { results: { [entityId]: { status: 'failed' } } };
  assert.equal(selectTarget(target, base, checkpoint).reason, 'failed_requires_retry_flag');
  assert.equal(selectTarget(target, base, checkpoint, { retryFailed: true }).eligible, true);
  assert.throws(() => parseTargets(JSON.stringify({ entity_id: entityId, website_url: 'https://coffee.example/terms', source_ids: ['123'] })));
  assert.throws(() => parseTargets(JSON.stringify({ entity_id: entityId, website_url: 'https://coffee.example/' })), /source_ids/);
  assert.equal(parseArgs(['--input', 'targets.ndjson']).run, false);
  assert.throws(() => parseArgs(['--concurrency', '3']), /Concurrency/);
});

test('runner previews without crawling, runs bounded verified targets, resumes without duplicates and refuses changed input', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mce-runner-test-'));
  const input = path.join(directory, 'targets.ndjson');
  const rows = [1, 2].map((number) => ({ entity_id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`, website_url: `https://roaster${number}.example`, source_ids: [`${number}`] }));
  fs.writeFileSync(input, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const tables = {
    entities: rows.map((row, i) => ({ id: row.entity_id, name: `Roaster ${i}`, website_url: row.website_url })),
    entity_roles: rows.map((row) => ({ entity_id: row.entity_id, role: 'roaster' })),
    entity_source_ids: rows.map((row, i) => ({ id: String(i), entity_id: row.entity_id, source: 'my_coffee_explorer', source_id: String(i + 1) })),
    entity_crawl_state: [], crawl_runs: [],
  };
  const db = { from(table) {
    let values = tables[table];
    return {
      select() { return this; }, order() { return this; },
      in(key, allowed) { values = values.filter((value) => allowed.includes(value[key])); return this; },
      eq(key, match) { values = values.filter((value) => value[key] === match); return this; },
      async range(start, end) { return { data: values.slice(start, end + 1), error: null }; },
    };
  } };
  let initialized = 0;
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const dependencies = {
    db,
    httpClient: { async initProxyPool() { initialized += 1; } },
    blacklist: { async getBlacklistTerms() { return []; } },
    async crawlRoaster() {
      calls += 1; active += 1; maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { success: true, visitResults: { coffeeFound: 2, visited: 3 } };
    },
  };
  try {
    const preview = await run({ input, concurrency: 2, run: false }, dependencies);
    assert.equal(preview.eligibleCount, 2);
    assert.equal(initialized, 0); assert.equal(calls, 0);
    assert.equal(fs.existsSync(`${input}.crawl-checkpoint.json`), false);
    const completed = await run({ input, concurrency: 2, run: true }, dependencies);
    assert.equal(completed.completedCount, 2);
    assert.equal(maximumActive, 2);
    assert.equal(calls, 2);
    assert.equal(fs.existsSync(`${input}.crawl-checkpoint.json.lock`), false);
    assert.equal(fs.statSync(`${input}.crawl-checkpoint.json`).mode & 0o777, 0o600);
    const resumed = await run({ input, concurrency: 2, run: true }, dependencies);
    assert.equal(resumed.eligibleCount, 0);
    assert.equal(calls, 2);
    rows[0].reason = 'changed verified input';
    fs.writeFileSync(input, rows.map((row) => JSON.stringify(row)).join('\n'));
    await assert.rejects(run({ input, concurrency: 2, run: true }, dependencies), /hash mismatch/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
