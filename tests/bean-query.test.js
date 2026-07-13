'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadScript } = require('./helpers/load-script');

const documents = new Map();
let fetchImpl = async () => { throw new Error('fetch not configured'); };
let retryImpl = fn => fn();
let clearedTimers = 0;
let appended = [];

class FakeDOMParser {
  parseFromString(source) {
    return documents.get(source);
  }
}

const query = loadScript('src/bean/query.js', [
  'buildAccountWorkItems',
  'createQueryRowContext',
  'getQueryRowSkipDetail',
  'appendSkippedResultForRow',
  'appendNoHitResultsForRows',
  'appendErrorResultsForRows',
  'appendMatchResultsForRows',
  'createBeanListRequestTemplate',
  'buildBeanQueryCacheKey',
  'queryAllBeanPagesCached',
  'queryAllBeanPages',
  'queryBeanList',
  'getTotalPages',
  'extractBeanMatches',
  'shouldStopBeanPaging',
  'extractBeanPageCreateTimes',
  'isCreateTimeInRange',
  'parseBeanCreateTime'
], {
  state: { stopped: false, beanQueryCache: new Map() },
  clean: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
  normalizeText: value => String(value ?? '').replace(/[\s:_\-—（）()【】\[\]{}\.。]+/g, '').trim(),
  matchesBeanKeyword: (text, keyword) => String(text).includes(keyword) && !String(text).includes('排除'),
  getTrackerNameFromRow: row => row.trackerName || '',
  getTrackerErpFromRow: row => row.trackerErp || '',
  getRowValueByCandidates: row => row.creator || '',
  shouldIgnoreCreator: value => value === 'ignored',
  CREATOR_COL_CANDIDATES: ['创建人'],
  NO_BEAN_RECORD_DETAIL: '未查询到记录',
  BEAN_QUERY_MAX_PAGES: 6,
  BEAN_PAGINATION_CONCURRENCY: 2,
  BEAN_REQUEST_TIMEOUT_MS: 30000,
  DOMParser: FakeDOMParser,
  URL,
  URLSearchParams,
  AbortController,
  location: { origin: 'http://newadmin.jpos.jd.com' },
  FormData: class {
    constructor(form) { this.form = form; }
    entries() { return this.form.entries; }
  },
  fetch(...args) { return fetchImpl(...args); },
  runWithRetry(fn) { return retryImpl(fn); },
  setTimeout() { return 1; },
  clearTimeout() { clearedTimers++; },
  yieldToBrowser: async () => {},
  appendResult(item) { appended.push(item); }
});

function makeTable(headers, rows) {
  const headerCells = headers.map(textContent => ({ textContent }));
  const bodyRows = rows.map(row => {
    const cells = row.cells.map(textContent => ({ textContent }));
    return {
      querySelectorAll(selector) { return selector === 'td' ? cells : []; },
      querySelector(selector) { return selector === 'a[href]' ? row.link || null : null; }
    };
  });
  return {
    textContent: headers.join(' '),
    querySelectorAll(selector) {
      if (selector === 'thead th') return headerCells;
      if (selector === 'tbody tr') return bodyRows;
      return [];
    }
  };
}

function makeDocument(table, totalPages = 1) {
  return {
    querySelector(selector) {
      if (selector === '#sample-table-2') return table;
      if (selector === '#totalPage') return { value: String(totalPages), getAttribute: () => String(totalPages) };
      return null;
    },
    querySelectorAll(selector) { return selector === 'table' ? [table] : []; }
  };
}

test('account work items group normalized accounts and preserve skip reasons', () => {
  const rows = [
    { account: ' alice ', event: 'E1', trackerName: '张三', trackerErp: 'zhangsan' },
    { account: 'alice', event: 'E2' },
    { account: '', event: 'E3' },
    { account: '', event: 'E4', creator: 'ignored' }
  ];
  const work = query.buildAccountWorkItems(rows, 'account', 'event');

  assert.equal(work.groups.length, 1);
  assert.equal(work.groups[0].account, 'alice');
  assert.deepEqual(work.groups[0].rows.map(row => row.eventNo), ['E1', 'E2']);
  assert.deepEqual(work.skipped.map(item => item.detail), ['客户账户为空', '无需查询']);
  assert.equal(work.groups[0].rows[0].trackerName, '张三');
  assert.equal(work.groups[0].rows[0].trackerErp, 'zhangsan');
});

test('result appenders map rows and matches without losing details', () => {
  appended = [];
  const rows = [{ eventNo: 'E1', trackerName: '张三', trackerErp: 'z', account: 'a' }];

  query.appendSkippedResultForRow(rows[0], 'skip');
  assert.equal(query.appendNoHitResultsForRows(rows), 1);
  assert.equal(query.appendErrorResultsForRows(rows, new Error('boom')), 1);
  assert.equal(query.appendMatchResultsForRows(rows, [{
    createTime: '2026-07-13 10:00:00', amount: '10', businessNo: 'B', businessNo1: 'B1',
    activityId: 'A', activityName: '活动', detail: '命中', sourceLink: '/detail'
  }]), 1);

  assert.deepEqual(appended.map(item => item.status), ['跳过', '未命中', '异常', '命中']);
  assert.equal(appended[2].detail, 'boom');
  assert.equal(appended[3].businessNo1, 'B1');
});

test('request templates and cache keys normalize inputs', () => {
  const form = {
    action: '',
    entries: [['token', 'x'], ['ignoredFile', { name: 'file' }]]
  };
  const template = query.createBeanListRequestTemplate(form);
  assert.equal(template.action, 'http://newadmin.jpos.jd.com/tool/beanList');
  assert.equal(template.params.toString(), 'token=x');

  const range = { start: new Date(1000), end: new Date(2000) };
  assert.equal(query.buildBeanQueryCacheKey(' a ', ' key ', range), 'a|key|1000|2000');
});

test('query cache coalesces concurrent calls and evicts failed promises', async () => {
  globalThis.state.beanQueryCache = new Map();
  let calls = 0;
  let release;
  globalThis.queryAllBeanPages = async () => {
    calls++;
    return new Promise(resolve => { release = resolve; });
  };

  const range = { start: new Date(1000), end: new Date(2000) };
  const first = query.queryAllBeanPagesCached({}, 'a', 'k', range);
  const second = query.queryAllBeanPagesCached({}, ' a ', ' k ', range);
  assert.equal(calls, 1);
  release(['match']);
  assert.deepEqual(await first, ['match']);
  assert.deepEqual(await second, ['match']);

  globalThis.state.beanQueryCache = new Map();
  globalThis.queryAllBeanPages = async () => { throw new Error('temporary'); };
  await assert.rejects(query.queryAllBeanPagesCached({}, 'a', 'k', range), /temporary/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(globalThis.state.beanQueryCache.size, 0);

  globalThis.queryAllBeanPages = async () => ['recovered'];
  assert.deepEqual(await query.queryAllBeanPagesCached({}, 'a', 'k', range), ['recovered']);
});

test('JPOS pagination stops after a batch containing an entirely old page', async () => {
  globalThis.state.stopped = false;
  const requested = [];
  let yields = 0;
  globalThis.queryBeanList = async (_template, _account, page) => {
    requested.push(page);
    return `page-${page}`;
  };
  globalThis.extractBeanMatches = html => [html];
  globalThis.getTotalPages = () => 6;
  globalThis.shouldStopBeanPaging = html => html === 'page-3';
  globalThis.yieldToBrowser = async () => { yields++; };

  const matches = await query.queryAllBeanPages({}, 'account', 'keyword', {});
  assert.deepEqual(requested, [1, 2, 3]);
  assert.deepEqual(matches, ['page-1', 'page-2', 'page-3']);
  assert.equal(yields, 0);
});

test('JPOS request posts normalized page data and classifies invalid responses', async () => {
  retryImpl = fn => fn();
  clearedTimers = 0;
  let received;
  fetchImpl = async (url, options) => {
    received = { url, options };
    return { ok: true, status: 200, text: async () => '<table id="sample-table-2"></table>' };
  };
  const requestTemplate = {
    action: 'http://newadmin.jpos.jd.com/tool/beanList',
    params: new URLSearchParams('token=x&pin=old&pageIndex=9')
  };

  const html = await query.queryBeanList(requestTemplate, 'alice', 2);
  assert.match(html, /sample-table-2/);
  assert.equal(received.options.method, 'POST');
  assert.equal(received.options.credentials, 'include');
  assert.equal(received.options.body, 'token=x&pin=alice&pageIndex=2');
  assert.ok(received.options.signal);
  assert.equal(clearedTimers, 1);

  fetchImpl = async () => ({ ok: false, status: 503, text: async () => '' });
  await assert.rejects(query.queryBeanList(requestTemplate, 'a'), /HTTP 503/);
  fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html>登录</html>' });
  await assert.rejects(query.queryBeanList(requestTemplate, 'a'), /登录失效/);
  fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html>unexpected</html>' });
  await assert.rejects(query.queryBeanList(requestTemplate, 'a'), /未找到京豆列表/);
  assert.equal(clearedTimers, 4);
});

test('bean table parsing follows headers, keywords, time range, and page age', () => {
  const headers = ['业务编号', '创建时间', '收入/支出', '其他', '活动ID', '活动名称', '详细说明', '业务编号1'];
  const table = makeTable(headers, [
    { cells: ['B1', '2026-07-13 10:00:00', '10', '', 'A1', '活动', '满意度调研发放京豆', 'B1-1'], link: { href: '/detail/1' } },
    { cells: ['B2', '2026-07-13 11:00:00', '20', '', 'A2', '活动', '排除满意度调研', 'B2-1'] },
    { cells: ['B3', '2026-02-30 12:00:00', '30', '', 'A3', '活动', '满意度调研', 'B3-1'] }
  ]);
  documents.set('bean-table', makeDocument(table, 4));

  const range = { start: new Date(2026, 6, 13, 0, 0, 0), end: new Date(2026, 6, 13, 23, 59, 59) };
  const matches = query.extractBeanMatches('bean-table', '满意度调研', range);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].businessNo, 'B1');
  assert.equal(matches[0].businessNo1, 'B1-1');
  assert.equal(matches[0].sourceLink, '/detail/1');
  assert.equal(query.getTotalPages('bean-table'), 4);

  const oldTable = makeTable(headers, [
    { cells: ['B', '2026-07-01 10:00:00', '', '', '', '', '', ''] },
    { cells: ['B', 'invalid', '', '', '', '', '', ''] }
  ]);
  documents.set('old-table', makeDocument(oldTable));
  assert.equal(query.shouldStopBeanPaging('old-table', range), true);

  const mixedTable = makeTable(headers, [
    { cells: ['B', '2026-07-01 10:00:00', '', '', '', '', '', ''] },
    { cells: ['B', '2026-07-13 10:00:00', '', '', '', '', '', ''] }
  ]);
  documents.set('mixed-table', makeDocument(mixedTable));
  assert.equal(query.shouldStopBeanPaging('mixed-table', range), false);
});

test('bean date parser accepts supported formats and rejects invalid values', () => {
  assert.equal(query.parseBeanCreateTime('2026年7月13日 09:08:07').getSeconds(), 7);
  assert.equal(query.parseBeanCreateTime('20260713 090807').getMinutes(), 8);
  assert.equal(query.parseBeanCreateTime('2026-02-30 12:00:00'), null);
  assert.equal(query.parseBeanCreateTime(''), null);
  assert.equal(query.isCreateTimeInRange('invalid', { start: new Date(0) }), false);
  assert.equal(query.isCreateTimeInRange('2026-07-13 09:00:00', null), true);
});
