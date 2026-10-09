'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getCrawlConcurrency } = require('../src/crawlConcurrency');

test('default concurrency overlaps four roasters with one page worker each', () => {
  assert.deepEqual(getCrawlConcurrency({}), { roasters: 4, pagesPerRoaster: 1 });
});

test('explicit positive whole-number settings remain configurable', () => {
  assert.deepEqual(getCrawlConcurrency({ PARALLEL_ROASTERS: '2', CRAWLER_PAGE_CONCURRENCY: '1' }), {
    roasters: 2, pagesPerRoaster: 1,
  });
});

for (const name of ['PARALLEL_ROASTERS', 'CRAWLER_PAGE_CONCURRENCY']) {
  test(`${name} rejects settings that could create an invalid worker pool`, () => {
    for (const value of ['', ' ', '0', '-1', '1.5', 'NaN', 'Infinity', 'many', '9007199254740992']) {
      assert.throws(() => getCrawlConcurrency({ [name]: value }), new RegExp(name));
    }
  });
}
