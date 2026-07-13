'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadScript } = require('./helpers/load-script');

const utils = loadScript('src/common/utils.js', [
  'unique',
  'normalizeText',
  'clean',
  'matchesBeanKeyword',
  'addDays',
  'createAsyncLimiter',
  'isRetriableNetworkError',
  'runWithRetry',
  'runConcurrentTasks',
  'formatDateOnly',
  'formatDateTimeSeconds',
  'getCrmDateRangeInfo',
  'escapeRegExp',
  'escapeHtml',
  'yieldToBrowser'
], {
  EXCLUDED_KEYWORDS: ['机器人满意度调研'],
  CRM_DATE_RANGE_TODAY: 'today',
  CRM_DATE_RANGE_YESTERDAY_TODAY: 'yesterday_today',
  state: { stopped: false },
  window: {
    requestAnimationFrame(callback) { callback(); },
    setTimeout
  }
});

test('text helpers normalize, deduplicate, and filter excluded bean records', () => {
  assert.deepEqual(utils.unique([' A ', 'A', '', null, 'B']), ['A', 'B']);
  assert.equal(utils.normalizeText(' 客户（账号）- A '), '客户账号A');
  assert.equal(utils.clean('  a\n  b  '), 'a b');
  assert.equal(utils.matchesBeanKeyword('满意度调研发放京豆', '满意度调研'), true);
  assert.equal(utils.matchesBeanKeyword('机器人满意度调研发放京豆', '满意度调研'), false);
  assert.equal(utils.matchesBeanKeyword('其他活动', '满意度调研'), false);
});

test('date helpers preserve local dates and CRM range semantics', () => {
  const source = new Date(2026, 6, 13, 9, 8, 7);
  const next = utils.addDays(source, 2);

  assert.equal(utils.formatDateOnly(next), '2026-07-15');
  assert.equal(utils.formatDateTimeSeconds(source), '2026-07-13 09:08:07');
  assert.equal(source.getDate(), 13);

  const today = utils.getCrmDateRangeInfo('today', source);
  assert.equal(today.beginTimeStr, '2026-07-13 00:00:00');
  assert.equal(today.label, '2026-07-13');

  const twoDays = utils.getCrmDateRangeInfo('yesterday_today', source);
  assert.equal(twoDays.beginTimeStr, '2026-07-12 00:00:00');
  assert.equal(twoDays.label, '2026-07-12 至 2026-07-13');

  const fallback = utils.getCrmDateRangeInfo('unsupported', source);
  assert.equal(fallback.mode, 'today');
});

test('async limiter and task runner honor concurrency limits', async () => {
  const limit = utils.createAsyncLimiter(2);
  let active = 0;
  let maxActive = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const jobs = [0, 1, 2].map(index => limit(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    if (index < 2) await gate;
    active--;
    return index;
  }));

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maxActive, 2);
  release();
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2]);

  globalThis.state.stopped = false;
  const visited = [];
  await utils.runConcurrentTasks([1, 2, 3, 4], 2, async value => {
    visited.push(value);
  });
  assert.deepEqual(visited.sort(), [1, 2, 3, 4]);
});

test('retry classification excludes invalid extension contexts', async () => {
  globalThis.isExtensionContextInvalidatedText = value => /context invalidated/i.test(String(value));

  assert.equal(utils.isRetriableNetworkError(new Error('HTTP 503')), true);
  assert.equal(utils.isRetriableNetworkError(new Error('Failed to fetch')), true);
  assert.equal(utils.isRetriableNetworkError(new Error('Extension context invalidated')), false);
  assert.equal(utils.isRetriableNetworkError(new Error('validation failed')), false);

  globalThis.state.stopped = false;
  assert.equal(await utils.runWithRetry(async () => 'ok'), 'ok');
  await assert.rejects(
    utils.runWithRetry(async () => { throw new Error('fatal'); }, { retries: 2, isRetriable: () => false }),
    /fatal/
  );
});

test('escaping helpers and browser yield produce safe deterministic output', async () => {
  assert.equal(utils.escapeRegExp('a+b?'), 'a\\+b\\?');
  assert.equal(utils.escapeHtml('<a title="x">\'&'), '&lt;a title=&quot;x&quot;&gt;&#39;&amp;');
  await utils.yieldToBrowser();
});
