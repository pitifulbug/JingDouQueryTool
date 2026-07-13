'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadScript } = require('./helpers/load-script');

const config = loadScript('src/config.js', ['createInitialState']);

test('initial state creates independent mutable collections and safe defaults', () => {
  const first = config.createInitialState();
  const second = config.createInitialState();

  assert.deepEqual(first.rows, []);
  assert.deepEqual(first.results, []);
  assert.equal(first.running, false);
  assert.equal(first.loadingCrm, false);
  assert.equal(first.requestSource, 'jpos');
  assert.equal(first.crmDateRangeMode, 'today');
  assert.deepEqual(first.stats, { total: 0, done: 0, hit: 0, noHit: 0, error: 0, skipped: 0 });
  assert.ok(first.beanQueryCache instanceof Map);

  first.rows.push({ id: 1 });
  first.beanQueryCache.set('a', 1);
  first.columnFilters.status = new Set(['命中']);
  assert.equal(second.rows.length, 0);
  assert.equal(second.beanQueryCache.size, 0);
  assert.deepEqual(second.columnFilters, {});
});
