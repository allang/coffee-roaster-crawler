const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const WEBSHARE_API_BASE = 'https://proxy.webshare.io/api/v2';
let proxyPool = [];
let proxyIndex = 0;
let proxyPoolInitialized = false;
const domainLastRequestAt = new Map();

async function initProxyPool() {
  const apiKey = process.env.WEBSHARE_API_KEY;
  if (!apiKey) {
    console.warn('[Proxy] WEBSHARE_API_KEY not set, proxy fallback disabled');
    return false;
  }

  try {
    const allProxies = [];
    let page = 1;
    const pageSize = 100;
    
    while (true) {
      const response = await axios.get(`${WEBSHARE_API_BASE}/proxy/list/`, {
        headers: { 'Authorization': `Token ${apiKey}` },
        params: { page, page_size: pageSize, mode: 'direct' },
        timeout: 10000,
      });

      const results = response.data.results || [];
      allProxies.push(...results);
      
      if (!response.data.next) {
        break;
      }
      page++;
    }

    proxyPool = allProxies;
    proxyPoolInitialized = true;
    console.log(`[Proxy] Loaded ${proxyPool.length} proxies from Webshare`);
    return proxyPool.length > 0;
  } catch (error) {
    console.error('[Proxy] Failed to load proxy pool:', error.message);
    return false;
  }
}

function getNextProxyAgent() {
  if (proxyPool.length === 0) return null;
  const proxy = proxyPool[proxyIndex % proxyPool.length];
  proxyIndex++;
  const proxyUrl = `http://${proxy.username}:${proxy.password}@${proxy.proxy_address}:${proxy.port}`;
  return new HttpsProxyAgent(proxyUrl);
}

function hasProxies() {
  return proxyPool.length > 0;
}

function normalizeFetchUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function buildUrlVariants(url) {
  const normalized = normalizeFetchUrl(url);
  const variants = [];
  let parsed;

  try {
    parsed = new URL(normalized);
  } catch {
    return normalized ? [normalized] : [];
  }

  const hostname = parsed.hostname;
  const hosts = [hostname];
  if (hostname.startsWith('www.')) {
    hosts.push(hostname.slice(4));
  } else {
    hosts.push(`www.${hostname}`);
  }

  const schemes = [parsed.protocol.replace(':', '') || 'https'];
  if (parsed.protocol === 'https:') {
    schemes.push('http');
  } else if (parsed.protocol === 'http:') {
    schemes.push('https');
  }

  const originalPath = parsed.pathname || '/';
  const paths = [originalPath];
  if (originalPath !== '/') {
    paths.push(originalPath.endsWith('/') ? originalPath.slice(0, -1) : `${originalPath}/`);
  }

  for (const scheme of schemes) {
    for (const host of hosts) {
      for (const path of paths) {
        const candidate = new URL(parsed.href);
        candidate.protocol = `${scheme}:`;
        candidate.hostname = host;
        candidate.pathname = path || '/';
        const href = candidate.href;
        if (!variants.includes(href)) {
          variants.push(href);
        }
      }
    }
  }

  if (!variants.includes(normalized)) {
    variants.unshift(normalized);
  }
  return variants;
}

function throttleKey(url) {
  try {
    const host = new URL(normalizeFetchUrl(url)).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

async function paceHost(url, throttle = false, logger = null) {
  const delayMs = Number(process.env.CRAWLER_PER_DOMAIN_DELAY_MS || 250);
  if (!delayMs || delayMs <= 0) return 0;

  const key = throttleKey(url);
  if (!key) return 0;

  const now = Date.now();
  const lastRequestAt = domainLastRequestAt.get(key) || 0;
  const waitMs = throttle ? Math.max(0, lastRequestAt + delayMs - now) : 0;
  domainLastRequestAt.set(key, now + waitMs);

  if (waitMs > 0) {
    if (logger) {
      logger.info('HTTP', `Pacing ${key} for ${waitMs}ms before fallback/retry`);
    }
    await delay(waitMs);
  }
  return waitMs;
}

function classifyFetchFailure(error) {
  const status = error?.response?.status || 0;
  const message = error?.message || '';
  const code = error?.code || '';

  if (status === 403) return 'blocked';
  if (status === 404) return 'stale_or_missing_url';
  if (status === 429) return 'rate_limited';
  if (status === 402 || status === 409) return 'http_state';
  if (status >= 500) return 'transient_http';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo|ENOTFOUND|Name or service/i.test(message)) return 'dns';
  if (/CERTIFICATE|SSL|TLS/i.test(message)) return 'tls_certificate';
  if (code === 'ECONNABORTED' || /timeout/i.test(message)) return 'timeout';
  if (code === 'ERR_FR_TOO_MANY_REDIRECTS' || /redirect/i.test(message)) return 'redirect_loop';
  if (status === 0) return 'network';
  return 'unknown';
}

function isRetryableStatus(status) {
  return status === 403 || status === 429 || status >= 500 || status === 0;
}

const BROWSER_HEADERS = {
  'User-Agent': CHROME_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
};

const JSON_HEADERS = {
  'User-Agent': CHROME_UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

const XML_HEADERS = {
  'User-Agent': CHROME_UA,
  'Accept': 'application/xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

const IMAGE_HEADERS = {
  'User-Agent': CHROME_UA,
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'cross-site',
};

function getHeadersForType(headerType) {
  switch (headerType) {
    case 'json':
      return { ...JSON_HEADERS };
    case 'xml':
      return { ...XML_HEADERS };
    case 'image':
      return { ...IMAGE_HEADERS };
    default:
      return { ...BROWSER_HEADERS };
  }
}

function jitteredDelay(baseMs, jitterMs = null) {
  const jitter = jitterMs || Math.floor(baseMs * 0.5);
  const min = Math.max(100, baseMs - jitter);
  const max = baseMs + jitter;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function jitteredSleep(baseMs, jitterMs = null) {
  const sleepTime = jitteredDelay(baseMs, jitterMs);
  await delay(sleepTime);
  return sleepTime;
}

function parseRetryAfter(headers) {
  const retryAfter = headers['retry-after'];
  if (!retryAfter) return null;
  
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }
  
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  
  return null;
}

async function fetchWithBackoff(url, options = {}) {
  const {
    headerType = 'browser',
    maxRetries = 1,
    initialBackoffMs = 2000,
    maxBackoffMs = 30000,
    referer = null,
    logger = null,
    useProxyFallback = true,
    useUrlFallback = false,
  } = options;
  
  const baseHeaders = getHeadersForType(headerType);
  const candidateUrls = useUrlFallback ? buildUrlVariants(url) : [normalizeFetchUrl(url)];
  const attemptedUrls = [];
  let lastError;
  
  for (let candidateIndex = 0; candidateIndex < candidateUrls.length; candidateIndex++) {
    const candidateUrl = candidateUrls[candidateIndex];
    let backoffMs = initialBackoffMs;

    const requestConfig = {
      timeout: options.timeout || 30000,
      responseType: options.responseType || 'text',
      maxRedirects: 10,
      headers: { ...baseHeaders },
    };

    if (referer) {
      requestConfig.headers.Referer = referer;
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const throttleDelayMs = await paceHost(
        candidateUrl,
        candidateIndex > 0 || attempt > 0,
        logger,
      );

      try {
        const response = await axios.get(candidateUrl, requestConfig);
        return {
          success: true,
          data: response.data,
          status: response.status,
          headers: response.headers,
          finalUrl: response.request?.res?.responseUrl || response.config?.url || candidateUrl,
          usedUrlFallback: candidateIndex > 0,
          attemptedUrls,
        };
      } catch (error) {
        lastError = error;
        const status = error.response?.status || 0;
        const message = error.message || 'Unknown error';
        const failureCategory = classifyFetchFailure(error);

        attemptedUrls.push({
          url: candidateUrl,
          attempt: attempt + 1,
          status,
          message,
          failureCategory,
          usedUrlFallback: candidateIndex > 0,
          throttleDelayMs,
        });

        if (logger) {
          logger.warn('HTTP', `Attempt ${attempt + 1}/${maxRetries + 1} failed for ${candidateUrl}`, {
            status,
            message,
            failureCategory,
          });
        }

        const shouldRetry = isRetryableStatus(status);

        if (shouldRetry && attempt < maxRetries) {
          const retryAfterMs = parseRetryAfter(error.response?.headers || {});
          const baseWaitTime = retryAfterMs || Math.min(backoffMs, maxBackoffMs);
          const jitteredWaitTime = jitteredDelay(baseWaitTime, Math.floor(baseWaitTime * 0.3));

          if (logger) {
            logger.info('HTTP', `Backing off for ${jitteredWaitTime}ms before retry`);
          }
          await delay(jitteredWaitTime);
          backoffMs *= 2;
        } else {
          break;
        }
      }
    }
  }
  
  if (useProxyFallback && hasProxies()) {
    for (let candidateIndex = 0; candidateIndex < candidateUrls.length; candidateIndex++) {
      const candidateUrl = candidateUrls[candidateIndex];
      const proxyAgent = getNextProxyAgent();
      if (!proxyAgent) break;

      if (logger) {
        logger.info('HTTP', `Trying with proxy fallback for ${candidateUrl}`);
      }

      const requestConfig = {
        timeout: options.timeout || 30000,
        responseType: options.responseType || 'text',
        maxRedirects: 10,
        headers: { ...baseHeaders },
        httpsAgent: proxyAgent,
        httpAgent: proxyAgent,
        proxy: false,
      };

      if (referer) {
        requestConfig.headers.Referer = referer;
      }

      const throttleDelayMs = await paceHost(candidateUrl, true, logger);

      try {
        const response = await axios.get(candidateUrl, requestConfig);
        if (logger) {
          logger.success('HTTP', `Proxy fallback succeeded for ${candidateUrl}`);
        }
        return {
          success: true,
          data: response.data,
          status: response.status,
          headers: response.headers,
          finalUrl: response.request?.res?.responseUrl || response.config?.url || candidateUrl,
          usedProxy: true,
          usedUrlFallback: candidateIndex > 0,
          attemptedUrls,
        };
      } catch (proxyError) {
        lastError = proxyError;
        const status = proxyError.response?.status || 0;
        const message = proxyError.message || 'Unknown error';
        const failureCategory = classifyFetchFailure(proxyError);

        attemptedUrls.push({
          url: candidateUrl,
          attempt: 1,
          status,
          message,
          failureCategory,
          usedProxy: true,
          usedUrlFallback: candidateIndex > 0,
          throttleDelayMs,
        });

        if (logger) {
          logger.warn('HTTP', `Proxy fallback also failed for ${candidateUrl}`, {
            status,
            error: proxyError.message,
            failureCategory,
          });
        }
      }
    }
  }
  
  return {
    success: false,
    error: lastError?.message || 'Request failed',
    status: lastError?.response?.status || 0,
    failureCategory: classifyFetchFailure(lastError),
    attemptedUrls,
  };
}

async function fetchHtml(url, options = {}) {
  return fetchWithBackoff(url, { ...options, headerType: 'browser' });
}

async function fetchJson(url, options = {}) {
  return fetchWithBackoff(url, { ...options, headerType: 'json' });
}

async function fetchXml(url, options = {}) {
  return fetchWithBackoff(url, { ...options, headerType: 'xml' });
}

async function fetchImage(url, options = {}) {
  return fetchWithBackoff(url, { ...options, headerType: 'image', responseType: 'arraybuffer' });
}

module.exports = {
  fetchHtml,
  fetchJson,
  fetchXml,
  fetchImage,
  fetchWithBackoff,
  jitteredDelay,
  jitteredSleep,
  delay,
  initProxyPool,
  hasProxies,
  buildUrlVariants,
  normalizeFetchUrl,
  classifyFetchFailure,
  CHROME_UA,
  BROWSER_HEADERS,
  JSON_HEADERS,
  XML_HEADERS,
  IMAGE_HEADERS,
};
