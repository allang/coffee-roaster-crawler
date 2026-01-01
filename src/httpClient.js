const axios = require('axios');
const https = require('https');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

const cookieJars = new Map();

function getCookieJar(domain) {
  if (!cookieJars.has(domain)) {
    cookieJars.set(domain, new CookieJar());
  }
  return cookieJars.get(domain);
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function createClient(url, headerType = 'browser') {
  const domain = getDomain(url);
  const jar = getCookieJar(domain);
  
  let headers;
  switch (headerType) {
    case 'json':
      headers = { ...JSON_HEADERS };
      break;
    case 'xml':
      headers = { ...XML_HEADERS };
      break;
    case 'image':
      headers = { ...IMAGE_HEADERS };
      break;
    default:
      headers = { ...BROWSER_HEADERS };
  }
  
  const client = wrapper(axios.create({
    headers,
    httpsAgent,
    timeout: 30000,
    maxRedirects: 10,
    jar,
    withCredentials: true,
  }));
  
  return client;
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
    maxRetries = 3,
    initialBackoffMs = 2000,
    maxBackoffMs = 30000,
    referer = null,
    logger = null,
  } = options;
  
  const client = createClient(url, headerType);
  
  const requestConfig = {
    timeout: options.timeout || 30000,
    responseType: options.responseType || 'text',
  };
  
  if (referer) {
    requestConfig.headers = { Referer: referer };
  }
  
  let lastError;
  let backoffMs = initialBackoffMs;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.get(url, requestConfig);
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
      
      if (status === 403 || status === 429) {
        const retryAfterMs = parseRetryAfter(error.response?.headers || {});
        const waitTime = retryAfterMs || Math.min(backoffMs, maxBackoffMs);
        
        if (attempt < maxRetries) {
          if (logger) {
            logger.info('HTTP', `Backing off for ${waitTime}ms before retry`);
          }
          await delay(waitTime);
          backoffMs *= 2;
        }
      } else if (status >= 500 || status === 0) {
        if (attempt < maxRetries) {
          const waitTime = Math.min(backoffMs, maxBackoffMs);
          await delay(waitTime);
          backoffMs *= 2;
        }
      } else {
        break;
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

function clearCookieJar(domain) {
  if (domain) {
    cookieJars.delete(domain);
  } else {
    cookieJars.clear();
  }
}

module.exports = {
  fetchHtml,
  fetchJson,
  fetchXml,
  fetchImage,
  fetchWithBackoff,
  createClient,
  jitteredDelay,
  jitteredSleep,
  delay,
  clearCookieJar,
  CHROME_UA,
  BROWSER_HEADERS,
  JSON_HEADERS,
  XML_HEADERS,
  IMAGE_HEADERS,
};
