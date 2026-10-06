'use strict';
// Evidence collection only: observed public product hosts are NOT automatically roasters.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { classifyUrl, identity, pageRequest, clean } = require('./validate-sites.cjs');
const { installLegalGuard } = require('./legal-guard.cjs');
const host = u => new URL(u).hostname.toLowerCase().replace(/^www\./, '');
const key = row => crypto.createHash('sha256').update(`${row.name}\n${row.website_url}`).digest('hex');
const stamp = () => new Date().toISOString();

function visibleText(html) {
  return clean(html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(?:p|div|h[1-6]|li|section)>/gi, '. '), 200000);
}
function evidence(html, url) {
  const metadata = identity(html);
  if (/\b(?:privacy|legal|terms|cookie|polic(?:y|ies)|datenschutz|impressum|disclaimer)\b/i.test(metadata.title || '')) {
    return { title:metadata.title, legalContentExcluded:true, roastingSnippets:[], assertions:[], retailerSignals:[], furtherEvidenceUrls:[] };
  }
  const text = visibleText(html);
  // Capture native-language evidence for human review too. These keywords never
  // establish ownership or approve an entity automatically.
  const roast = /(?<![\p{L}\p{N}])(?:roast(?:ed|er|ers|ery|eries|ing)?|torr[eé]fact[\p{L}]*|torr[eé]fi[\p{L}]*|r[oö]st[\p{L}]*|ger[oö]st[\p{L}]*|torrefa[\p{L}]*|tost[\p{L}]*|rost(?:a|ar|as|ad|ade|at|eri|ning)[\p{L}]*|br[eæ]nn[\p{L}]*|rist(?:er|eri|ning|et|ede|a)[\p{L}]*|palarn[\p{L}]*|palimy|wypal[\p{L}]*|pra[zżž][\p{L}]*|paaht[\p{L}]*|p[öo]rk[öo]l[\p{L}]*|torra[\p{L}]*|rang|обжар[\p{L}]*|kavur[\p{L}]*|branden|branderij|烘焙|焙煎)(?![\p{L}\p{N}])/iu;
  const segments = text.split(/(?<=[.!?])\s+/).filter(s => roast.test(s));
  const links = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const u = classifyUrl(new URL(m[1].replace(/&amp;/g, '&'), url));
      if (host(u) !== host(url) || u.search || u.hash || !/(?:about|our-story|our-coffee|roastery|roasting|wholesale)/i.test(u.pathname)) continue;
      if (!links.includes(u.href)) links.push(u.href);
    } catch {}
  }
  const assertions = [
    ['we_roast', /\bwe\s+(?:hand[ -])?roast\b/i],
    ['our_roastery', /\bour\s+(?:own\s+)?roastery\b/i],
    ['roast_in_house', /\broast(?:ed|ing)?\s+(?:our\s+[^.]{0,35}\s+)?in[ -]house\b/i],
    ['small_batch_roasting', /\bsmall[ -]batch\s+roast(?:ing|er|ers)\b/i],
  ].filter(([,re]) => re.test(text)).map(([name]) => name);
  const retailerSignals = ['multi-roaster','multiroaster','curated roasters','roasters we carry','coffee marketplace'].filter(s => text.toLowerCase().includes(s));
  return { ...metadata, roastingSnippets: segments.slice(0, 12).map(s => s.slice(0, 420)), assertions, retailerSignals, furtherEvidenceUrls: links.slice(0, 8) };
}
async function fetchPage(value) {
  const deadline = Date.now() + 20000;
  let url = classifyUrl(value);
  const redirects = [];
  for (let hop = 0; hop <= 5; hop++) {
    const res = await pageRequest(url, deadline);
    if ([301,302,303,307,308].includes(res.status) && res.location) {
      if (hop === 5) throw new Error('redirect_limit');
      const next = classifyUrl(new URL(res.location, url));
      redirects.push({from:url.href,to:next.href,status:res.status});url=next;continue;
    }
    return { requestedUrl:value, finalUrl:url.href, status:res.status, contentType:res.contentType, redirects, truncated:!!res.truncated, ...(res.html ? evidence(res.html,url.href) : {}) };
  }
}
async function review(row) {
  const result = { key:key(row), at:stamp(), candidate:row, status:'review_required', pages:[] };
  try {
    const root = await fetchPage(row.website_url);result.pages.push(root);
    if (root.status >= 400) result.status = `http_${root.status}`;
    else if (root.legalContentExcluded) result.status = 'legal_content_excluded';
    else if (root.parkedSignals?.length) result.status = 'parked_or_unrelated';
    else {
      // At most two observed first-party links; never invent URLs or traverse recursively.
      for (const url of (root.furtherEvidenceUrls || []).filter(u => u !== root.finalUrl).slice(0,2)) {
        try { result.pages.push(await fetchPage(url)); } catch (e) { result.pages.push({requestedUrl:url,error:e.code||e.message}); }
      }
    }
  } catch (e) { result.status='failed';result.error=e.code||e.message; }
  result.explicitSelfRoastingSignal=result.pages.some(p=>p.assertions?.length);
  result.retailerSignal=result.pages.some(p=>p.retailerSignals?.length);
  result.verifiedOfficialRoaster=false; // Only a separate reviewed decision can approve import/crawl.
  return result;
}
async function main() {
  const [input,output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: brand-site-review.cjs INPUT.json OUTPUT.ndjson');
  const rows = JSON.parse(fs.readFileSync(input,'utf8'));
  if (!Array.isArray(rows) || rows.some(r=>!r.name||!r.website_url)) throw new Error('Expected explicit [{name,website_url,...provenance}]');
  const completed = new Set(fs.existsSync(output) ? fs.readFileSync(output,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line).key) : []);
  const pending = rows.filter(r=>!completed.has(key(r)));
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const audit = fs.openSync(output+'.audit.ndjson','a',0o600);
  const fd = fs.openSync(output,'a',0o600);
  const guard = installLegalGuard({onEvent:e=>fs.writeSync(audit,JSON.stringify(e)+'\n')});
  let cursor=0,finished=0;
  console.log(JSON.stringify({at:stamp(),pending:pending.length,cached:completed.size}));
  try {
    await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
      while(cursor<pending.length){ const row=await review(pending[cursor++]);fs.writeSync(fd,JSON.stringify(row)+'\n');finished++;if(finished%10===0||finished===pending.length)console.log(JSON.stringify({at:stamp(),finished,total:pending.length})); }
    }));
  } finally { guard.uninstall();fs.closeSync(fd);fs.closeSync(audit); }
  console.log(JSON.stringify({at:stamp(),finished,total:pending.length,guard:guard.stats,output}));
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={evidence,visibleText,review};
