const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const WEBSHARE_API_BASE = 'https://proxy.webshare.io/api/v2';
let proxyPool = [];
let proxyIndex = 0;
let proxyPoolInitialized = false;

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
  } = options;
  
  const baseHeaders = getHeadersForType(headerType);
  
  const requestConfig = {
    timeout: options.timeout || 30000,
    responseType: options.responseType || 'text',
    maxRedirects: 10,
    headers: { ...baseHeaders },
  };
  
  if (referer) {
    requestConfig.headers.Referer = referer;
  }
  
  let lastError;
  let backoffMs = initialBackoffMs;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, requestConfig);
      return {
        success: true,
        data: response.data,
        status: response.status,
        headers: response.headers,
      };
    } catch (error) {
      lastError = error;
      const status = error.response?.status || 0;
      const message = error.message || 'Unknown error';
      
      if (logger) {
        logger.warn('HTTP', `Attempt ${attempt + 1}/${maxRetries + 1} failed for ${url}`, { status, message });
      }
      
      const shouldRetry = status === 403 || status === 429 || status >= 500 || status === 0;
      
      if (shouldRetry && attempt < maxRetries) {
        const retryAfterMs = parseRetryAfter(error.response?.headers || {});
        const baseWaitTime = retryAfterMs || Math.min(backoffMs, maxBackoffMs);
        const jitteredWaitTime = jitteredDelay(baseWaitTime, Math.floor(baseWaitTime * 0.3));
        
        if (logger) {
          logger.info('HTTP', `Backing off for ${jitteredWaitTime}ms before retry`);
        }
        await delay(jitteredWaitTime);
        backoffMs *= 2;
      } else if (!shouldRetry) {
        break;
      }
    }
  }
  
  if (useProxyFallback && hasProxies()) {
    const proxyAgent = getNextProxyAgent();
    if (proxyAgent) {
      if (logger) {
        logger.info('HTTP', `Trying with proxy fallback for ${url}`);
      }
      
      try {
        const proxyConfig = { 
          ...requestConfig, 
          httpsAgent: proxyAgent,
          httpAgent: proxyAgent,
          proxy: false,
        };
        const response = await axios.get(url, proxyConfig);
        if (logger) {
          logger.success('HTTP', `Proxy fallback succeeded for ${url}`);
        }
        return {
          success: true,
          data: response.data,
          status: response.status,
          headers: response.headers,
          usedProxy: true,
        };
      } catch (proxyError) {
        if (logger) {
          logger.warn('HTTP', `Proxy fallback also failed for ${url}`, { error: proxyError.message });
        }
      }
    }
  }
  
  return {
    success: false,
    error: lastError?.message || 'Request failed',
    status: lastError?.response?.status || 0,
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
  CHROME_UA,
  BROWSER_HEADERS,
  JSON_HEADERS,
  XML_HEADERS,
  IMAGE_HEADERS,
};
