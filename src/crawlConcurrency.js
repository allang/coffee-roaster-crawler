'use strict';

function positiveInteger(env, name, fallback) {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return value;
}

function getCrawlConcurrency(env = process.env) {
  return {
    roasters: positiveInteger(env, 'PARALLEL_ROASTERS', 4),
    pagesPerRoaster: positiveInteger(env, 'CRAWLER_PAGE_CONCURRENCY', 1),
  };
}

module.exports = { getCrawlConcurrency };
