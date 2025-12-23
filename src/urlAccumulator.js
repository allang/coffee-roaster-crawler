const globalLogger = require('./logger');

class UrlAccumulator {
  constructor(entityId, entityName, log = null) {
    this.entityId = entityId;
    this.entityName = entityName;
    this.log = log || globalLogger;
    this.urls = new Map();
    this.stats = {
      discovered: 0,
      fromSitemap: 0,
      fromDomLinks: 0,
      duplicatesSkipped: 0,
    };
  }

  addUrl(url, source = 'sitemap', sourceUrl = null, metadata = {}) {
    const normalizedUrl = this.normalizeUrl(url);
    
    if (!normalizedUrl) {
      return false;
    }

    if (this.urls.has(normalizedUrl)) {
      this.stats.duplicatesSkipped++;
      return false;
    }

    this.urls.set(normalizedUrl, {
      url: normalizedUrl,
      originalUrl: url,
      discoveredVia: source,
      discoveredFromUrl: sourceUrl,
      discoveredAt: new Date().toISOString(),
      visited: false,
      visitedAt: null,
      blacklisted: false,
      blacklistedMatch: null,
      sentToGpt: false,
      ...metadata,
    });

    this.stats.discovered++;
    if (source === 'sitemap') {
      this.stats.fromSitemap++;
    } else if (source === 'dom_links') {
      this.stats.fromDomLinks++;
    }

    return true;
  }

  addUrlsFromSitemap(sitemapUrls) {
    this.log.info('Accumulator', `Adding ${sitemapUrls.length} URLs from sitemap`);
    
    let added = 0;
    for (const entry of sitemapUrls) {
      const url = typeof entry === 'string' ? entry : entry.url;
      if (this.addUrl(url, 'sitemap', null, {
        lastmod: entry.lastmod || null,
        priority: entry.priority || null,
      })) {
        added++;
      }
    }

    this.log.success('Accumulator', `Added ${added} new URLs (${sitemapUrls.length - added} duplicates)`);
    return added;
  }

  normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      let normalized = parsed.toString();
      normalized = normalized.replace(/\/+$/, '');
      return normalized;
    } catch {
      return null;
    }
  }

  getUnvisitedUrls() {
    return Array.from(this.urls.values())
      .filter(u => !u.visited && !u.blacklisted);
  }

  getAllUrls() {
    return Array.from(this.urls.values());
  }

  getUrlCount() {
    return this.urls.size;
  }

  markVisited(url) {
    const normalizedUrl = this.normalizeUrl(url);
    const entry = this.urls.get(normalizedUrl);
    if (entry) {
      entry.visited = true;
      entry.visitedAt = new Date().toISOString();
    }
  }

  markBlacklisted(url, matchedTerm) {
    const normalizedUrl = this.normalizeUrl(url);
    const entry = this.urls.get(normalizedUrl);
    if (entry) {
      entry.blacklisted = true;
      entry.blacklistedMatch = matchedTerm;
    }
  }

  getStats() {
    const urls = this.getAllUrls();
    return {
      ...this.stats,
      total: urls.length,
      visited: urls.filter(u => u.visited).length,
      unvisited: urls.filter(u => !u.visited && !u.blacklisted).length,
      blacklisted: urls.filter(u => u.blacklisted).length,
    };
  }

  printSummary() {
    const stats = this.getStats();
    this.log.header(`URL Accumulator Summary: ${this.entityName}`);
    this.log.info('Stats', 'URL Statistics', stats);
    this.log.divider();
  }
}

module.exports = { UrlAccumulator };
