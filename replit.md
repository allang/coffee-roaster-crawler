# Coffee Roaster Crawler

A Node.js crawler for discovering coffee products from roaster websites.

## Overview

This crawler:
1. Fetches roaster entities from Supabase database
2. Loads blacklist terms to filter unwanted URLs
3. Detects the platform (Shopify, WooCommerce, etc.)
4. Discovers and crawls sitemaps
5. Filters URLs against blacklist terms
6. Removes already known pages to avoid re-crawling
7. Visits unknown pages and sends DOM to GPT-4o-mini for classification
8. Saves coffee products to database and marks pages as known

## Project Structure

```
src/
  config.js          - Configuration and environment validation
  logger.js          - Colorful logging with roaster slug prefix
  supabase.js        - Supabase client initialization
  httpClient.js      - Centralized HTTP client with browser headers and backoff
  roasters.js        - Functions to fetch and filter roaster entities
  crawlRuns.js       - Crawl run tracking (create, complete, fail)
  blacklist.js       - Blacklist term loading and URL filtering
  knownPages.js      - Known pages management and filtering
  gptClassifier.js   - GPT-4o-mini classification for coffee pages
  shopifyProduct.js  - Fetch Shopify product JSON for variant prices
  productSaver.js    - Save products and variants to database
  pageVisitor.js     - Fetch pages and orchestrate classification
  sitemap.js         - Sitemap discovery and parsing
  bfsCrawler.js      - BFS crawling for non-sitemap sites
  urlAccumulator.js  - URL collection and deduplication
  crawler.js         - Main crawling logic
  imageDownloader.js - Download product images to Supabase storage
  ascii/             - ASCII art for start/end of crawl
index.js             - Entry point
```

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (secret)
- `OPENAI_API_KEY` - OpenAI API key for GPT classification (secret)
- `LOG_LEVEL` - Optional: DEBUG, INFO, WARN, ERROR (default: DEBUG)

## Running

```bash
node index.js
```

## Crawl Run Tracking

Each crawl is logged to the `crawl_runs` table with:
- Status (running/completed/failed)
- Platform detected
- Pages discovered, visited, sent to GPT
- Coffees found
- Start/finish timestamps

**24h Cooldown**: Roasters with a completed/running crawl in the last 24 hours are skipped.

**Allow Crawl Flag**: Roasters with `entity_crawl_state.allow_crawl=false` are skipped. Missing entries default to allowed.

## Recent Changes

- 2026-01-01: Centralized HTTP client (httpClient.js) with realistic Chrome browser headers
- 2026-01-01: Added Sec-Fetch-*, Accept-Language, Accept-Encoding headers to reduce bot detection
- 2026-01-01: Exponential backoff on 403/429/5xx errors with configurable retries
- 2026-01-01: Jittered delays between requests (random variation around base delay)
- 2026-01-01: Respect Retry-After header when present
- 2026-01-01: Store variant_price_currency to product_variants currency column
- 2025-12-25: Added Shopify product JSON fetching for accurate variant prices
- 2025-12-25: Merge GPT classification with Shopify JSON data (prefer JSON for prices, GPT for flavor notes)
- 2025-12-25: Added retry queue for unreachable sites (retried at end of crawl)
- 2025-12-25: Bypass SSL certificate validation for misconfigured sites
- 2025-12-25: Parallel crawling now runs 4 roasters simultaneously
- 2025-12-23: Added BFS crawling for non-Shopify sites without sitemaps
- 2025-12-23: Added roaster slug prefix to all console logs for easier debugging
- 2025-12-23: Added image downloading to Supabase storage with media_assets/product_media linking
- 2025-12-23: Added metadata JSONB column for storing all product attributes
- 2025-12-23: Added crawl_runs table logging with 24h cooldown enforcement
- 2025-12-23: Added GPT-4o-mini classification for coffee product pages
- 2025-12-23: Added known pages filtering to skip already-crawled URLs
- 2025-12-23: Added product saving to database with variants and coffee facts
- 2025-12-23: Added blacklist filtering from crawl_blacklist_terms table
- 2025-12-23: Initial crawler implementation with sitemap support
