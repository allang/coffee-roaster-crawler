'use strict';

// Isolated-process adapter. No proxy pool, cookies, credentials, browser, or JS execution.
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const crypto = require('node:crypto');
const { assertAllowedUrl, decoded, safeRequestLabel, isLegalPath } = require('./legal-guard.cjs');
const blockedPath = /(?:^|\/)(?:api|account|accounts|login|log-in|signin|sign-in|signup|sign-up|auth|oauth|password|admin|wp-admin|wp-login\.php|cart|checkout|challenge|captcha)(?:[/._-]|$)/i;
const secretQuery = /^(?:access_token|token|api_key|apikey|password|passwd|authorization|auth|session|sessionid|code)$/i;
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function host(value) { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
      a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (net.isIP(address) === 6) return /^[23]/.test(address.toLowerCase()) && !/^(?:2002:|2001:(?:db8|0*|0*2|0*1[0-9a-f]):)/i.test(address);
  return false;
}
function publicUrl(value) {
  const u = assertAllowedUrl(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443') fail('unsafe_url');
  if (u.hostname === 'localhost' || /\.(?:local|internal|localhost)$/i.test(u.hostname)) fail('private_host');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g,'')) && !publicAddress(u.hostname.replace(/^\[|\]$/g,''))) fail('private_address');
  if (blockedPath.test(decoded(u.pathname))) fail('auth_or_nonpublic_path');
  for (const [key] of u.searchParams) if (secretQuery.test(key)) fail('credential_query');
  u.hash = '';
  return u;
}
function ownerUrl(value, owner) {
  const u = publicUrl(value);
  if (host(u) !== host(owner)) fail('owner_host_mismatch');
  return u;
}
function redirectUrl(value, current, owner, kind = 'html') {
  const next = publicUrl(new URL(value, current));
  if (kind !== 'image') ownerUrl(next, owner);
  else if (host(next) !== host(current)) fail('image_cross_host_redirect');
  return next;
}
function activeMarkup(text) {
  // Embedded anti-spam libraries and closed signup dialogs are not access gates.
  // This never executes scripts, opens a dialog, submits a form, or solves a CAPTCHA.
  const source=String(text).replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const stack=[],out=[];const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for(const token of source.match(/<[^>]*>|[^<]+/g)||[]){
    const close=token.match(/^<\/\s*([a-z][\w:-]*)/i);
    if(close){const tag=close[1].toLowerCase(),i=stack.map(x=>x.tag).lastIndexOf(tag);if(i>=0)stack.splice(i);if(!stack.some(x=>x.hidden))out.push(token);continue;}
    const open=token.match(/^<([a-z][\w:-]*)\b/i);
    if(!open){if(!stack.some(x=>x.hidden))out.push(token);continue;}
    const tag=open[1].toLowerCase(),attrs={};
    for(const m of token.slice(open[0].length).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))attrs[m[1].toLowerCase()]=m[2]??m[3]??m[4]??'';
    const visibility=[...(attrs.style||'').matchAll(/(?:^|;)\s*(display|visibility)\s*:\s*([^;]+)/gi)].map(m=>({property:m[1].toLowerCase(),value:m[2].trim().toLowerCase()}));
    // ARIA is not visual hiding. Conflicting or unknown inline visibility values
    // also remain active rather than guessing CSS cascade or !important behavior.
    const cssHidden=visibility.length>0&&visibility.every(x=>x.property==='display'?/^none(?:\s*!important)?$/.test(x.value):/^hidden(?:\s*!important)?$/.test(x.value));
    const visibilityConflict=visibility.length>0&&!cssHidden;
    const hidden=!visibilityConflict&&(Object.hasOwn(attrs,'hidden')||cssHidden||(tag==='dialog'&&!Object.hasOwn(attrs,'open')));
    const suppressed=hidden||stack.some(x=>x.hidden);
    if(!suppressed)out.push(token);
    if(!voids.has(tag)&&!token.endsWith('/>'))stack.push({tag,hidden:suppressed});
  }
  return out.join(' ');
}
function challengeReason(text) {
  const source=String(text),title=source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]||'';
  if(/(?:just a moment|access denied|attention required|security (?:check|verification)|checking your browser|verify (?:you are|you're) human|password protected|log[ -]?in|sign[ -]?in)/i.test(title))return 'challenge_or_login_title';
  const active=activeMarkup(source),plain=active.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  if(/(?:cf-chl-|challenge-platform|\bid\s*=\s*["']?challenge-form)/i.test(active))return 'active_challenge_markup';
  for(const tag of active.match(/<(?:div|iframe|form)\b[^>]*>/gi)||[])for(const m of tag.matchAll(/\s(?:class|id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))if(/(?:g-recaptcha|hcaptcha)/i.test(m[1]??m[2]??m[3]))return 'active_captcha_widget';
  if(/<iframe\b[^>]*\bsrc\s*=\s*["']?[^\s>]*(?:recaptcha|hcaptcha)/i.test(active))return 'active_captcha_frame';
  if(/<input\b[^>]*type\s*=\s*["']?password(?:["'\s/>]|$)/i.test(active))return 'active_password_input';
  if(/(?:verify\s+(?:that\s+)?you(?:\s+are|['’]re)\s+(?:a\s+)?human|complete\s+(?:the\s+)?captcha|checking\s+your\s+browser|enable\s+javascript\s+and\s+cookies\s+to\s+continue|unusual\s+traffic\s+from\s+your)/i.test(plain))return 'visible_challenge_instruction';
  return null;
}
function challengeHtml(text) { return challengeReason(text)!==null; }
function legalDocumentHtml(text) {
  const title = String(text).match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '';
  const entities = { amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',tab:' ',newline:' ',colon:':',sol:'/',auml:'ä',ouml:'ö',uuml:'ü',szlig:'ß',eacute:'é',egrave:'è',agrave:'à',acirc:'â',ocirc:'ô',ecirc:'ê',ccedil:'ç' };
  const plain = decoded(title.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_,n)=>{const cp=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return cp>0&&cp<=0x10ffff?String.fromCodePoint(cp):' ';}).replace(/&([a-z]+);/gi,(_,n)=>entities[n.toLowerCase()]||' ')).replace(/<[^>]*>/g,' ').normalize('NFKC');
  return plain.split(/[^\p{L}\p{N}]+/u).filter(Boolean).some(word=>isLegalPath(word)) || /\b(?:data\s*protection|mentions\s+l[eé]gales)\b/i.test(plain);
}
function imageUrls(html, base) {
  const out = new Set();
  for (const tag of String(html).match(/<img\b[^>]*>/gi) || []) for (const m of tag.matchAll(/(?:\s|^)(?:src|data-src)\s*=\s*["']([^"']+)["']/gi)) {
    try { out.add(publicUrl(new URL(m[1].replace(/&amp;/g,'&'), base)).href); } catch {}
  }
  return out;
}
async function dispatch(url, address, { timeoutMs, maxBytes, kind }) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET', agent: false, rejectUnauthorized: true,
      headers: { 'user-agent': 'EveryCoffeeProductSeed/1.0 (+https://every.coffee)', accept: kind === 'image' ? 'image/*' : kind === 'json' ? 'application/json' : 'text/html,application/xhtml+xml', 'accept-encoding': 'identity' },
      lookup(_name, options, callback) { callback(null, options?.all ? [address] : address.address, address.family); },
    }, response => {
      const info = { status: response.statusCode, location: response.headers.location, contentType: String(response.headers['content-type'] || ''), encoding: String(response.headers['content-encoding'] || '') };
      if (info.status >= 300) { response.destroy(); clearTimeout(timer); resolve({ ...info, body: Buffer.alloc(0) }); return; }
      if (info.encoding && info.encoding !== 'identity') { response.destroy(); clearTimeout(timer); reject(Object.assign(new Error('unsupported_encoding'), { code: 'unsupported_encoding' })); return; }
      let bytes = 0; const chunks = [];
      response.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) request.destroy(Object.assign(new Error('response_too_large'), { code: 'response_too_large' })); else chunks.push(chunk); });
      response.on('end', () => { clearTimeout(timer); resolve({ ...info, body: Buffer.concat(chunks) }); });
      response.on('error', error => { clearTimeout(timer); reject(error); });
    });
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('request_timeout'), { code: 'request_timeout' })), timeoutMs);
    request.once('error', error => { clearTimeout(timer); reject(error); });
    request.end();
  });
}
function createTransport({ context, onEvent = () => {}, resolver = name => dns.lookup(name, { all: true }), send = dispatch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let lastStart = 0;
  async function request(value, kind) {
    const c = context();
    if (!c?.target || !c.url) fail('missing_product_context');
    if (c.hardStop) fail(c.hardStop);
    let u = kind === 'image' ? publicUrl(value) : ownerUrl(value, c.target.website_url);
    if (kind === 'image' && !c.images?.has(u.href)) fail('unobserved_image');
    if (kind === 'html' && u.href !== c.url) fail('unmanifested_page');
    const jsonUrl = new URL(c.url); jsonUrl.pathname = jsonUrl.pathname.replace(/\/$/,'') + '.json'; jsonUrl.search = '';
    if (kind === 'json' && u.href !== jsonUrl.href) fail('unmanifested_json');
    if (kind === 'html' && c.cachedHtml) return c.cachedHtml;
    for (let hop = 0; hop <= 5; hop++) {
      const pause = 500 - (Date.now() - lastStart); if (pause > 0) await sleep(pause); lastStart = Date.now();
      const addresses = await resolver(u.hostname.replace(/^\[|\]$/g,''));
      if (!addresses.length || addresses.some(a => !publicAddress(a.address))) fail('private_or_reserved_dns');
      const selected = addresses.find(a => a.family === 4) || addresses[0];
      onEvent({ at: new Date().toISOString(), kind, url: safeRequestLabel(u), entityId: c.target.entity_id, disposition: 'allowed' });
      const response = await send(u, selected, { kind, timeoutMs: 20000, maxBytes: kind === 'image' ? 5 * 1024 * 1024 : 1024 * 1024 });
      if ([401,403,407,429].includes(response.status)) { c.hardStop = response.status === 429 ? 'rate_limited' : 'authentication_or_access_denied'; fail(c.hardStop); }
      if ([301,302,303,307,308].includes(response.status)) {
        if (!response.location || hop === 5) fail('redirect_limit');
        const next = redirectUrl(response.location, u, c.target.website_url, kind);
        if (kind !== 'image') {
          const original = kind === 'json' ? jsonUrl : new URL(c.url);
          const samePath = next.pathname.replace(/\/$/,'') === original.pathname.replace(/\/$/,'');
          if (!samePath && !(kind === 'html' && c.target.products?.some(p=>publicUrl(p.url).href===next.href))) fail('unmanifested_redirect');
        }
        u = next; continue;
      }
      if (response.status < 200 || response.status >= 300) fail('http_' + response.status);
      const type = response.contentType || '';
      if (kind === 'image' && !/^image\/(?:jpeg|png|webp|avif|gif)(?:;|$)/i.test(type)) fail('unexpected_image_type');
      if (kind === 'json' && !/^application\/json(?:;|$)/i.test(type)) fail('unexpected_json_type');
      if (kind === 'html' && !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type)) fail('unexpected_html_type');
      const text = kind === 'image' ? null : response.body.toString('utf8');
      if (kind === 'html' && (c.challengeReason=challengeReason(text))) { c.hardStop = 'authentication_or_challenge_page'; fail(c.hardStop); }
      if (kind === 'html' && legalDocumentHtml(text)) { c.hardStop = 'unexpected_legal_document'; fail(c.hardStop); }
      const data = kind === 'image' ? response.body : kind === 'json' ? JSON.parse(text) : text;
      if (kind === 'image') { c.imageHashes ||= new Set();c.imageHashes.add(crypto.createHash('md5').update(response.body).digest('hex')); }
      if (kind === 'html') {
        c.images = imageUrls(text, u);
        c.finalPageUrl = u.href;
      }
      if (kind === 'json') {
        const product = data.product || data;
        for (const img of [product.image, ...(product.images || [])]) {
          try { c.images.add(publicUrl(new URL(typeof img === 'string' ? img : img?.src, u)).href); } catch {}
        }
      }
      const result = { success: true, data, status: response.status, finalUrl: u.href, headers: { 'content-type': type } };
      if (kind === 'html') c.cachedHtml = result;
      return result;
    }
    fail('redirect_limit');
  }
  function adapter(kind) { return async value => {
    try { return await request(value, kind); }
    catch (error) {
      const c = context(); const code = String(error.code || 'request_failed').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,100);
      if (c) { c.networkErrors ||= []; c.networkErrors.push(code); if (/owner|private|auth|unmanifested|ECLEGAL|unsafe|credential|challenge|rate_limit/.test(code)) c.hardStop ||= code; }
      onEvent({ at: new Date().toISOString(), kind, url: safeRequestLabel(value), entityId: c?.target?.entity_id, disposition: 'failed', code, ...(c?.challengeReason?{challengeReason:c.challengeReason}:{}) });
      return { success: false, error: code, failureCategory: code };
    }
  }; }
  return { fetchHtml: adapter('html'), fetchJson: adapter('json'), fetchImage: adapter('image') };
}
module.exports = { publicAddress, publicUrl, ownerUrl, redirectUrl, challengeReason, challengeHtml, legalDocumentHtml, imageUrls, createTransport };
