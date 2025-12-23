# Coffee Roaster Crawler

A Node.js crawler for discovering coffee products from roaster websites.

## Overview

This crawler:
1. Fetches roaster entities from Supabase database
2. Detects the platform (Shopify, WooCommerce, etc.)
3. Discovers and crawls sitemaps
4. Accumulates URLs for visiting

## Project Structure

```
src/
  config.js      - Configuration and environment validation
  logger.js      - Colorful logging utility with levels
  supabase.js    - Supabase client initialization
  roasters.js    - Functions to fetch and filter roaster entities
  sitemap.js     - Sitemap discovery and parsing
  urlAccumulator.js - URL collection and deduplication
  crawler.js     - Main crawling logic
index.js         - Entry point
```

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (secret)
- `LOG_LEVEL` - Optional: DEBUG, INFO, WARN, ERROR (default: DEBUG)

## Running

```bash
node index.js
```

## Recent Changes

- 2025-12-23: Initial crawler implementation with sitemap support
