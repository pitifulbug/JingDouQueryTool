'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadScript(relativePath, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
  return context;
}

test('bean date parser rejects normalized impossible dates', () => {
  const context = loadScript('src/bean/query.js', {
    clean: value => String(value ?? '').trim()
  });

  assert.equal(context.parseBeanCreateTime('2026-02-30 12:00:00'), null);
  assert.equal(context.parseBeanCreateTime('2025-02-29 12:00:00'), null);
  assert.equal(context.parseBeanCreateTime('2024-02-29 12:00:00').getDate(), 29);
});

test('kfuad only stops pagination when the entire page is too old', () => {
  const context = loadScript('src/bean/query-kfuad.js', {
    clean: value => String(value ?? '').trim(),
    matchesBeanKeyword: (text, keyword) => String(text).includes(keyword),
    formatDateTimeSeconds: date => date.toISOString()
  });
  const begin = 2000;
  const end = 4000;

  const mixed = context.extractKfuadMatchesFromPayload({ content: [
    { createDate: 1500, userVisibleInfo: 'old' },
    { createDate: 3000, userVisibleInfo: 'target' }
  ] }, 'target', begin, end);
  assert.equal(mixed.earlyStop, false);
  assert.equal(mixed.matches.length, 1);

  const old = context.extractKfuadMatchesFromPayload({ content: [
    { createDate: 1000 },
    { createDate: 1500 }
  ] }, 'target', begin, end);
  assert.equal(old.earlyStop, true);
});

test('background proxy follows allowed redirects and rejects disallowed final URLs', async () => {
  let listener;
  let fetchOptions;
  let responseUrl = '';
  const context = loadScript('src/background/fetch-proxy.js', {
    AbortController,
    TextEncoder,
    URL,
    clearTimeout,
    setTimeout,
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) { listener = fn; }
        }
      }
    },
    fetch: async (_url, options) => {
      fetchOptions = options;
      return { ok: true, status: 200, statusText: 'OK', url: responseUrl || _url, text: async () => 'ok' };
    }
  });

  assert.throws(
    () => context.validateTargetUrl(new URL('https://user:pass@crm.jd.com/monitor/test'), 'GET'),
    /认证信息/
  );

  const response = await new Promise(resolve => {
    const keepChannelOpen = listener(
      { type: 'JD_BEAN_TOOL_FETCH_TEXT', url: 'https://crm.jd.com/monitor/test', options: { method: 'GET' } },
      { url: 'http://newadmin.jpos.jd.com/tool/beanList' },
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });
  assert.equal(response.ok, true);
  assert.equal(fetchOptions.redirect, 'follow');

  responseUrl = 'https://login.jd.com/login';
  const denied = await new Promise(resolve => {
    listener(
      { type: 'JD_BEAN_TOOL_FETCH_TEXT', url: 'https://crm.jd.com/monitor/test', options: { method: 'GET' } },
      { url: 'http://newadmin.jpos.jd.com/tool/beanList' },
      resolve
    );
  });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /不允许访问/);
});

test('query controls require detected columns and disable export while busy', () => {
  const button = () => ({ disabled: false });
  const state = {
    running: false,
    loadingCrm: false,
    rows: [{}],
    results: [{ status: '命中' }],
    autoDetected: { autoOk: false },
    crmData: {}
  };
  const els = {
    startBtn: button(), stopBtn: button(), exportBtn: button(), loadCrmBtn: button(),
    crmPersonSelect: button(), crmDateRange: button(), requestSource: button(),
    accountCol: button(), eventCol: button(), startTime: button(), endTime: button(), clearBtn: button()
  };
  const context = loadScript('src/ui/render.js', { state, els });

  context.updateButtons();
  assert.equal(els.startBtn.disabled, true);
  assert.equal(els.exportBtn.disabled, false);

  state.autoDetected.autoOk = true;
  context.updateButtons();
  assert.equal(els.startBtn.disabled, false);

  state.running = true;
  context.updateButtons();
  assert.equal(els.startBtn.disabled, true);
  assert.equal(els.exportBtn.disabled, true);
});

test('CRM multi-page loading explicitly fetches page 1', async () => {
  const requestedPages = [];
  class FakeDOMParser {
    parseFromString(text) {
      return { page: text, scripts: [] };
    }
  }
  const context = loadScript('src/crm/source-loader.js', {
    URL,
    DOMParser: FakeDOMParser,
    location: { href: 'https://crm.jd.com/monitor/monitorCaseInfo/monitorDetail?pageNumber=3' }
  });
  context.requestText = async () => 'initial-page-3';
  context.getCrmParamsFromUrlAndDoc = () => ({});
  context.getPreferredCrmPageSizeFromDoc = () => 2;
  context.findCrmDataTable = doc => doc;
  context.parseCrmMonitorTableObjects = table => ({
    headers: ['事件号', '客户账户'],
    rows: [{ 事件号: table.page, 客户账户: table.page }]
  });
  context.getCrmTotalCountFromDoc = () => 4;
  context.getCurrentCrmPageSizeFromDoc = () => 2;
  context.hasCrmRequiredHeader = () => true;
  context.fetchCrmMonitorPage = async (_params, page) => {
    requestedPages.push(page);
    return `page-${page}`;
  };
  context.dedupeCrmRows = value => value;

  const result = await context.fetchCrmRowsFromDetailUrl(context.location.href);
  assert.deepEqual(requestedPages, [1, 2]);
  assert.deepEqual(Array.from(result.rows, row => row['事件号']), ['page-1', 'page-2']);
});

test('kfuad aborts the batch when the extension context is invalidated', async () => {
  const fatal = Object.assign(new Error('Extension context invalidated.'), { code: 'EXTENSION_CONTEXT_INVALIDATED' });
  const state = {
    running: false,
    loadingCrm: false,
    stopped: false,
    crmData: null,
    rows: [{}],
    results: [],
    stats: { total: 0, done: 0, hit: 0, noHit: 0, error: 0, skipped: 0 }
  };
  const context = loadScript('src/bean/query-kfuad.js', {
    state,
    els: { accountCol: { value: 'account' }, eventCol: { value: 'event' } },
    DEFAULT_KEYWORD: 'target',
    BEAN_QUERY_CONCURRENCY: 1,
    KFUAD_PAGINATION_CONCURRENCY: 1,
    KFUAD_QUERY_PAGE_SIZE: 20,
    KFUAD_QUERY_MAX_PAGES: 50,
    KFUAD_DETAIL_BEANS_URL: 'https://kfuad.jd.com/test',
    UI_YIELD_EVERY_ROWS: 10,
    clean: value => String(value ?? '').trim(),
    hasRequiredQueryColumns: () => true,
    getSelectedTimeRange: () => ({ start: new Date(1000), end: new Date(2000) }),
    clearResultsView() {}, resetStats() {}, renderStats() {}, updateButtons() {}, log() {},
    buildAccountWorkItems: () => ({ skipped: [], groups: [{ account: 'a', rows: [{}] }] }),
    runWithRetry: async fn => fn(),
    sendRuntimeMessageSafe: async () => { throw fatal; },
    runConcurrentTasks: async (items, _limit, worker) => {
      for (let i = 0; i < items.length; i++) await worker(items[i], i);
    },
    isExtensionContextInvalidatedError: err => err && err.code === 'EXTENSION_CONTEXT_INVALIDATED',
    flushResultsNow() {}, yieldToBrowser: async () => {},
    appendSkippedResultForRow() {}, appendMatchResultsForRows() {},
    appendNoHitResultsForRows() {}, appendErrorResultsForRows() {},
    formatSourceContextForLog: () => '', alert() {}
  });

  await assert.rejects(context.runBatchKfuad(), /Extension context invalidated/);
  assert.equal(state.stopped, true);
  assert.equal(state.running, false);
});

test('manifest exposes release version 3.2.2', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '3.2.2');
});
