'use strict';

const http = require('node:http');
const https = require('node:https');
const { urlToHttpOptions } = require('node:url');

const INSTALL_KEY = Symbol.for('everycoffee.mce.legal-guard');
const LEGAL_WORDS = new Set([
  'term', 'terms', 'legal', 'privacy', 'cookie', 'cookies', 'policy', 'policies',
  'impressum', 'imprint', 'datenschutz', 'datenschutzerklaerung', 'datenschutzerklärung',
  'agb', 'disclaimer', 'disclaimers', 'rechtliches', 'confidentialite', 'confidentialité',
]);
const CONTENT_SELECTORS = new Set(['page', 'p', 'route', 'path', 'slug', 'view', 'section', 'document']);

function decoded(value) {
  let result = String(value).normalize('NFKC');
  for (let pass = 0; pass < 12; pass += 1) {
    if (!/%[0-9a-f]{2}/i.test(result)) return result;
    let next;
    try { next = decodeURIComponent(result); }
    catch { throw new Error('Malformed encoded request path'); }
    if (next === result) return result;
    result = next.normalize('NFKC');
  }
  if (/%[0-9a-f]{2}/i.test(result)) throw new Error('Excessively encoded request path');
  return result;
}

function normalizedPath(value) {
  const clean = decoded(value).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\\/g, '/').toLowerCase();
  // Inspect all segments, including ones later removed by dot normalization.
  return clean.split(/[\/?#]/).filter(Boolean);
}

function isLegalPath(value) {
  return normalizedPath(value).some((part) => {
    const words = part.split(/[-_\s.;:]+/).filter(Boolean);
    return words.some((word) => LEGAL_WORDS.has(word)) ||
      /^(?:termsofservice|termsandconditions|privacypolicy|cookiepolicy|dataprotection|legalnotice)$/i.test(part) ||
      /^(?:data[-_ ]protection|mentions[-_ ]legales|mentions[-_ ]légales)(?:[._;-]|$)/i.test(part);
  });
}

function legalReason(url, options = {}) {
  // A public About link was observed to serve a privacy document. Its path does
  // not reveal that fact, so block this known mislabeled page explicitly.
  if (url.hostname.toLowerCase().replace(/^www\./, '') === 'threehillscoffee.com' &&
      decoded(url.pathname).toLowerCase().replace(/\/+$/, '') === '/about') return 'known_mislabeled_legal_page';
  // This is our configured data table, not a website's terms page. Keep this
  // exception exact in both origin and path; no external or sibling path bypass.
  const internalBlacklistTable = options.internalDataOrigin && url.origin === options.internalDataOrigin &&
    url.pathname === '/rest/v1/crawl_blacklist_terms';
  if (!internalBlacklistTable && isLegalPath(url.pathname)) return 'legal_path';
  for (const [key, value] of url.searchParams) {
    if (CONTENT_SELECTORS.has(key.toLowerCase()) && isLegalPath(value)) return 'legal_content_selector';
  }
  return null;
}

function safeRequestLabel(value) {
  try { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}`; }
  catch { return '[invalid URL]'; }
}

function assertAllowedUrl(value, options = {}) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported request protocol');
    if (legalReason(url, options)) throw new Error('Forbidden legal content');
  } catch (cause) {
    const error = new Error(`Request blocked by legal-page guard: ${safeRequestLabel(value)}`);
    error.code = 'ECLEGALBLOCK';
    // Deliberately omit raw URL, query parameters, credentials, and cause text.
    throw error;
  }
  return url;
}

function nativeRequestUrl(protocol, args) {
  const first = args[0];
  let options = {};
  if (typeof first === 'string' || first instanceof URL) {
    options = urlToHttpOptions(new URL(first));
    if (args[1] && typeof args[1] === 'object') options = { ...options, ...args[1] };
  } else if (first && typeof first === 'object') options = first;
  else throw new Error('Unsupported native request arguments');
  const requestPath = String(options.path ?? `${options.pathname || '/'}${options.search || ''}`);
  // HTTP forward proxies put the final destination in absolute-form path.
  if (/^https?:\/\//i.test(requestPath)) return new URL(requestPath);
  const scheme = options.protocol || protocol;
  let host = String(options.hostname || options.host || 'localhost');
  if (host.includes(':') && !host.startsWith('[') && !/^[^:]+:\d+$/.test(host)) host = `[${host}]`;
  const port = options.port && !host.endsWith(`:${options.port}`) ? `:${options.port}` : '';
  return new URL(`${scheme}//${host}${port}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`);
}

function installLegalGuard(options = {}) {
  if (globalThis[INSTALL_KEY]) throw new Error('Legal guard already installed in this process');
  let internalDataOrigin;
  if (options.internalDataOrigin) {
    const configured = new URL(options.internalDataOrigin);
    if (configured.protocol !== 'https:' || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) {
      throw new Error('Internal data origin must be a plain HTTPS origin');
    }
    internalDataOrigin = configured.origin;
  }
  const allowedOptions = { internalDataOrigin };
  const originals = { httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get, fetch: globalThis.fetch };
  const stats = { attempted: 0, allowed: 0, blocked: 0, prohibitedRequestsSent: 0 };
  function check(value, transport) {
    stats.attempted += 1;
    try {
      const url = assertAllowedUrl(value, allowedOptions);
      stats.allowed += 1;
      options.onEvent?.({ at: new Date().toISOString(), disposition: 'allowed', transport, url: safeRequestLabel(url), context: options.context?.() || null });
      return url;
    } catch (error) {
      stats.blocked += 1;
      options.onEvent?.({ at: new Date().toISOString(), disposition: 'blocked', transport, url: safeRequestLabel(value), context: options.context?.() || null });
      throw error;
    }
  }
  function wrapNative(module, protocol, original) {
    module.request = function guardedRequest(...args) {
      check(nativeRequestUrl(protocol, args), protocol === 'http:' ? 'http' : 'https');
      return Reflect.apply(original, module, args);
    };
    module.get = function guardedGet(...args) {
      const request = module.request(...args);
      request.end();
      return request;
    };
  }
  wrapNative(http, 'http:', originals.httpRequest);
  wrapNative(https, 'https:', originals.httpsRequest);
  if (originals.fetch) {
    globalThis.fetch = async function guardedFetch(input, init) {
      let request = new Request(input, init);
      const redirectMode = request.redirect;
      for (let hop = 0; hop <= 20; hop += 1) {
        check(request.url, 'fetch');
        const replay = request.clone();
        const response = await originals.fetch(request, { redirect: 'manual' });
        const location = response.headers.get('location');
        if (![301, 302, 303, 307, 308].includes(response.status) || !location || redirectMode === 'manual') return response;
        if (redirectMode === 'error' || hop === 20) {
          await response.body?.cancel();
          throw new Error('Guarded fetch redirect refused');
        }
        const next = new URL(location, request.url);
        // Check before constructing or dispatching the next HTTP request.
        try { assertAllowedUrl(next, allowedOptions); }
        catch (error) { await response.body?.cancel(); check(next, 'fetch_redirect'); throw error; }
        const headers = new Headers(request.headers);
        if (next.origin !== new URL(request.url).origin) {
          for (const name of ['authorization', 'cookie', 'proxy-authorization']) headers.delete(name);
        }
        const switchToGet = response.status === 303 && request.method !== 'HEAD' ||
          [301, 302].includes(response.status) && request.method === 'POST';
        if (switchToGet) {
          headers.delete('content-length'); headers.delete('content-type');
          request = new Request(next, { method: 'GET', headers, signal: request.signal, redirect: 'manual' });
        } else request = new Request(next, new Request(replay, { headers, redirect: 'manual' }));
        await response.body?.cancel();
      }
      throw new Error('Guarded fetch redirect limit');
    };
  }
  const handle = {
    stats,
    uninstall() {
      http.request = originals.httpRequest; http.get = originals.httpGet;
      https.request = originals.httpsRequest; https.get = originals.httpsGet;
      globalThis.fetch = originals.fetch;
      delete globalThis[INSTALL_KEY];
    },
  };
  globalThis[INSTALL_KEY] = handle;
  return handle;
}

module.exports = { assertAllowedUrl, decoded, installLegalGuard, isLegalPath, nativeRequestUrl, safeRequestLabel };
