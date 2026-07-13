'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadScript } = require('./helpers/load-script');

let sendMessageImpl = async () => { throw new Error('sendMessage not configured'); };
let yields = 0;
const alerts = [];

const baseState = () => ({
  running: false,
  loadingCrm: false,
  stopped: false,
  crmData: null,
  rows: [],
  results: [],
  beanQueryCache: new Map(),
  stats: { total: 0, done: 0, hit: 0, noHit: 0, error: 0, skipped: 0 }
});

const kfuad = loadScript('src/bean/query-kfuad.js', [
  'runBatchKfuad',
  'buildKfuadCacheKey',
  'queryAllKfuadPagesCached',
  'queryAllKfuadPages',
  'extractKfuadMatchesFromPayload',
  'buildKfuadMatch',
  'formatKfuadTimestamp',
  'queryKfuadDetailBeans'
], {
  state: baseState(),
  els: { accountCol: { value: 'account' }, eventCol: { value: 'event' } },
  DEFAULT_KEYWORD: 'target',
  BEAN_QUERY_CONCURRENCY: 2,
  KFUAD_PAGINATION_CONCURRENCY: 2,
  KFUAD_QUERY_PAGE_SIZE: 2,
  KFUAD_QUERY_MAX_PAGES: 5,
  KFUAD_DETAIL_BEANS_URL: 'https://kfuad.jd.com/platformApi/api/jingdou/detailBeans?lang=zh_CN',
  UI_YIELD_EVERY_ROWS: 10,
  clean: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
  matchesBeanKeyword: (text, keyword) => String(text).includes(keyword),
  formatDateTimeSeconds(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },
  sendRuntimeMessageSafe(...args) { return sendMessageImpl(...args); },
  runWithRetry: fn => fn(),
  looksLikeLoginPage: text => /login|登录/i.test(String(text)),
  yieldToBrowser: async () => { yields++; },
  isExtensionContextInvalidatedError: error => error && error.code === 'EXTENSION_CONTEXT_INVALIDATED',
  syncCrmSelectionForRun() {},
  hasRequiredQueryColumns: () => true,
  getSelectedTimeRange: () => ({ start: new Date(1000), end: new Date(4000) }),
  clearResultsView() {},
  resetStats() {},
  renderStats() {},
  updateButtons() {},
  log() {},
  buildAccountWorkItems: () => ({ skipped: [], groups: [] }),
  runConcurrentTasks: async (items, _limit, worker) => {
    for (let index = 0; index < items.length; index++) await worker(items[index], index);
  },
  flushResultsNow() {},
  appendSkippedResultForRow() {},
  appendMatchResultsForRows: () => 1,
  appendNoHitResultsForRows: () => 1,
  appendErrorResultsForRows: () => 1,
  formatSourceContextForLog: () => '',
  alert(message) { alerts.push(message); },
  console
});

test('kfuad cache keys normalize inputs and failed requests are evicted', async () => {
  const range = { start: new Date(1000), end: new Date(4000) };
  assert.equal(kfuad.buildKfuadCacheKey(' a ', ' target ', range), 'kfuad|a|target|1000|4000');

  globalThis.state.beanQueryCache = new Map();
  let calls = 0;
  let release;
  globalThis.queryAllKfuadPages = async () => {
    calls++;
    return new Promise(resolve => { release = resolve; });
  };
  const first = kfuad.queryAllKfuadPagesCached('a', 'target', range);
  const second = kfuad.queryAllKfuadPagesCached(' a ', ' target ', range);
  assert.equal(calls, 1);
  release(['one']);
  assert.deepEqual(await first, ['one']);
  assert.deepEqual(await second, ['one']);

  globalThis.state.beanQueryCache = new Map();
  globalThis.queryAllKfuadPages = async () => { throw new Error('temporary'); };
  await assert.rejects(kfuad.queryAllKfuadPagesCached('a', 'target', range), /temporary/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(globalThis.state.beanQueryCache.size, 0);
});

test('kfuad pagination excludes pages fetched beyond the first terminal page', async () => {
  globalThis.state.stopped = false;
  yields = 0;
  const requested = [];
  const payloads = {
    1: {
      content: [
        { createDate: 3500, userVisibleInfo: 'target-page-1-a' },
        { createDate: 3400, userVisibleInfo: 'target-page-1-b' }
      ],
      totalPages: 5,
      last: false
    },
    2: {
      content: [{ createDate: 3300, userVisibleInfo: 'target-page-2' }],
      totalPages: 5,
      last: true
    },
    3: {
      content: [
        { createDate: 3200, userVisibleInfo: 'target-page-3-a' },
        { createDate: 3100, userVisibleInfo: 'target-page-3-b' }
      ],
      totalPages: 5,
      last: false
    }
  };
  globalThis.queryKfuadDetailBeans = async (_account, _begin, _end, page) => {
    requested.push(page);
    return payloads[page];
  };

  const matches = await kfuad.queryAllKfuadPages('account', 'target', { start: new Date(1000), end: new Date(4000) });
  assert.deepEqual(requested, [1, 2, 3]);
  assert.deepEqual(matches.map(item => item.detail), ['target-page-1-a', 'target-page-1-b', 'target-page-2']);
  assert.equal(yields, 1);
});

test('kfuad first-page stop conditions avoid unnecessary pagination', async () => {
  globalThis.state.stopped = false;
  const requested = [];
  globalThis.queryKfuadDetailBeans = async (_account, _begin, _end, page) => {
    requested.push(page);
    return {
      content: [
        { createDate: 100, userVisibleInfo: 'old' },
        { createDate: 200, userVisibleInfo: 'old' }
      ],
      totalPages: 5,
      last: false
    };
  };

  assert.deepEqual(await kfuad.queryAllKfuadPages('account', 'target', { start: new Date(1000), end: new Date(4000) }), []);
  assert.deepEqual(requested, [1]);
});

test('kfuad payload extraction handles ranges, keywords, and field mapping', () => {
  const payload = { content: [
    {
      createDate: new Date(2026, 6, 13, 9, 8, 7).getTime(),
      userVisibleInfo: ' target visible ',
      memo: 'memo',
      businessBill1: 'B1',
      businessBill2: 'B2',
      amount: 10,
      topBusinessId: 'T',
      secondBusinessId: 'S'
    },
    { createDate: 2500, userVisibleInfo: 'other', memo: 'target memo' },
    { createDate: 500, userVisibleInfo: 'target old' },
    { createDate: 'invalid', userVisibleInfo: 'target invalid' }
  ] };
  const end = new Date(2026, 6, 14).getTime();
  const result = kfuad.extractKfuadMatchesFromPayload(payload, 'target', 1000, end);

  assert.equal(result.earlyStop, false);
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].businessNo, 'B1');
  assert.equal(result.matches[0].businessNo1, 'B2');
  assert.equal(result.matches[0].amount, '10');
  assert.equal(result.matches[0].detail, 'target visible');
  assert.match(result.matches[0].createTime, /^2026-07-13 09:08:07$/);
  assert.equal(kfuad.formatKfuadTimestamp(0), '');
  assert.equal(kfuad.formatKfuadTimestamp('invalid'), '');
});

test('kfuad request sends the expected protocol payload', async () => {
  let received;
  sendMessageImpl = async (...args) => {
    received = args;
    return {
      ok: true,
      status: 200,
      text: JSON.stringify({ code: 200, result: { content: [], totalPages: 1, last: true } })
    };
  };

  const result = await kfuad.queryKfuadDetailBeans('alice', 1000, 4000, 2, 20);
  assert.equal(result.last, true);
  assert.equal(received[1], 30000);
  const message = received[0];
  assert.equal(message.type, 'JD_BEAN_TOOL_FETCH_TEXT');
  assert.equal(message.options.method, 'POST');
  assert.equal(message.options.credentials, 'include');
  assert.equal(message.options.timeoutMs, 30000);
  assert.deepEqual(JSON.parse(message.options.body), {
    pin: 'alice',
    dataSource: '1',
    detailType: null,
    beginDate: 1000,
    endDate: 4000,
    pageNo: 2,
    pageSize: 20
  });
});

test('kfuad request distinguishes transport, login, JSON, and API errors', async () => {
  sendMessageImpl = async () => ({ ok: false, error: 'transport failed' });
  await assert.rejects(kfuad.queryKfuadDetailBeans('a', 1, 2, 1, 20), /transport failed/);

  sendMessageImpl = async () => ({ ok: true, text: '<html>login</html>' });
  await assert.rejects(kfuad.queryKfuadDetailBeans('a', 1, 2, 1, 20), /登录态失效/);

  sendMessageImpl = async () => ({ ok: true, text: 'not-json' });
  await assert.rejects(kfuad.queryKfuadDetailBeans('a', 1, 2, 1, 20), /无法解析为 JSON/);

  sendMessageImpl = async () => ({ ok: true, text: JSON.stringify({ code: 401, message: '未登录' }) });
  await assert.rejects(kfuad.queryKfuadDetailBeans('a', 1, 2, 1, 20), /登录态失效/);

  sendMessageImpl = async () => ({ ok: true, text: JSON.stringify({ code: 500, message: 'bad request' }) });
  await assert.rejects(kfuad.queryKfuadDetailBeans('a', 1, 2, 1, 20), /bad request/);

  sendMessageImpl = async () => ({ ok: true, text: JSON.stringify({ code: 200 }) });
  assert.deepEqual(await kfuad.queryKfuadDetailBeans('a', 1, 2, 1, 20), { content: [], totalPages: 0, last: true });
});

test('kfuad batch validates prerequisites and propagates fatal context invalidation', async () => {
  globalThis.state = baseState();
  globalThis.state.rows = [{ account: 'a', event: 'E1' }];
  globalThis.hasRequiredQueryColumns = () => false;
  alerts.length = 0;
  await kfuad.runBatchKfuad();
  assert.match(alerts[0], /未能识别/);
  assert.equal(globalThis.state.running, false);

  globalThis.hasRequiredQueryColumns = () => true;
  globalThis.buildAccountWorkItems = () => ({ skipped: [], groups: [{ account: 'a', rows: [{}] }] });
  const fatal = Object.assign(new Error('Extension context invalidated.'), { code: 'EXTENSION_CONTEXT_INVALIDATED' });
  globalThis.queryAllKfuadPagesCached = async () => { throw fatal; };

  await assert.rejects(kfuad.runBatchKfuad(), /Extension context invalidated/);
  assert.equal(globalThis.state.running, false);
  assert.equal(globalThis.state.stopped, true);
});
