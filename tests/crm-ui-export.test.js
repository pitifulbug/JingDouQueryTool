'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadScript } = require('./helpers/load-script');

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    }
  };
}

function makeElement() {
  const listeners = new Map();
  return {
    disabled: false,
    value: '',
    textContent: '',
    innerHTML: '',
    title: '',
    style: {},
    dataset: {},
    classList: makeClassList(),
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener); },
    setAttribute(name, value) { this[name] = value; },
    appendChild() {},
    remove() {}
  };
}

function makeState() {
  return {
    running: false,
    loadingCrm: false,
    stopped: false,
    rows: [],
    headers: [],
    results: [],
    autoDetected: null,
    crmData: null,
    sourceContext: null,
    stats: { total: 0, done: 0, hit: 0, noHit: 0, error: 0, skipped: 0 },
    resultRenderQueue: [],
    resultRenderScheduled: false,
    columnFilters: {},
    beanQueryCache: new Map()
  };
}

class TestURL extends URL {}
TestURL.created = [];
TestURL.revoked = [];
TestURL.createObjectURL = blob => {
  TestURL.created.push(blob);
  return 'blob:test';
};
TestURL.revokeObjectURL = url => { TestURL.revoked.push(url); };

class TestBlob {
  constructor(parts, options) {
    this.parts = parts;
    this.type = options.type;
  }
}

const initialEls = {
  log: makeElement(),
  startTime: makeElement(),
  endTime: makeElement(),
  startBtn: makeElement(),
  stopBtn: makeElement(),
  exportBtn: makeElement(),
  loadCrmBtn: makeElement(),
  crmPersonSelect: makeElement(),
  crmDateRange: makeElement(),
  requestSource: makeElement(),
  accountCol: makeElement(),
  eventCol: makeElement(),
  clearBtn: makeElement(),
  resultBody: makeElement(),
  filterPopover: makeElement(),
  sourceSummary: makeElement(),
  detectStatus: makeElement()
};

const globals = {
  state: makeState(),
  els: initialEls,
  root: { querySelectorAll: () => [], contains: () => true },
  host: null,
  originalPageCache: null,
  clean: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
  normalizeText: value => String(value ?? '').replace(/[\s:_\-—（）()【】\[\]{}\.。]+/g, '').trim(),
  decodeHtmlAttr: value => String(value ?? '').replace(/&amp;/g, '&'),
  escapeRegExp: value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
  URL: TestURL,
  URLSearchParams,
  AbortController,
  Blob: TestBlob,
  CRM_GROUP_ALL: '__GROUP_ALL__',
  CRM_DATE_RANGE_TODAY: 'today',
  CRM_DATE_RANGE_YESTERDAY_TODAY: 'yesterday_today',
  DEFAULT_REQUEST_SOURCE: 'jpos',
  REQUEST_SOURCE_KFUAD: 'kfuad',
  TRACKER_COL_CANDIDATES: ['追踪人'],
  CREATOR_COL_CANDIDATES: ['创建人'],
  IGNORED_CREATORS: new Set(),
  RESULT_RENDER_BATCH_SIZE: 160,
  UI_YIELD_EVERY_ROWS: 10,
  location: { href: 'http://newadmin.jpos.jd.com/tool/beanList', origin: 'http://newadmin.jpos.jd.com', hostname: 'newadmin.jpos.jd.com', pathname: '/tool/beanList' },
  window: {
    innerWidth: 1280,
    innerHeight: 800,
    requestAnimationFrame(callback) { callback(); },
    setTimeout,
    addEventListener() {}
  },
  document: {
    createElement: () => makeElement(),
    body: { appendChild() {} },
    querySelector: () => null,
    getElementById: () => null
  },
  chrome: { runtime: { getManifest: () => ({ name: '京豆查询工具', version: '3.2.2' }) } },
  alert() {},
  console,
  setTimeout,
  clearTimeout,
  MutationObserver: class { observe() {} }
};

const local = loadScript('src/crm/local-exporter.js', [
  'collectDeptIdsFromText',
  'isLikelyDeptId',
  'buildCrmCaseCloseDetailUrl',
  'getCrmTotalCountFromDoc',
  'getCurrentCrmPageSizeFromDoc',
  'getPreferredCrmPageSizeFromDoc',
  'dedupeCrmRows',
  'parseCrmMonitorTable',
  'buildUniqueHeaders',
  'exportCrmMonitorTableToLocal'
], globals);
const source = loadScript('src/crm/source-loader.js', [
  'loadCrmSourceData',
  'looksLikeLoginPage',
  'findDirectCrmDetailUrlInText',
  'discoverCrmTreeEndpointUrls',
  'resolveDeptIdFromSources',
  'parseLooseJsonPayload',
  'pickDeptIdFromObject',
  'chooseBestDeptCandidate',
  'fetchCrmRowsFromDetailUrl',
  'extractTrackerChineseName',
  'extractTrackerErp',
  'normalizeCrmCaseCloseDetailUrl',
  'extractCrmParDeptIdFromUrl'
]);
const template = loadScript('src/ui/template.js', ['getPanelTemplate']);
const render = loadScript('src/ui/render.js', [
  'detectColumn',
  'hasRequiredQueryColumns',
  'canStartQuery',
  'hasExportableResults',
  'updateButtons',
  'formatDateTimeLocalInput',
  'getSelectedTimeRange',
  'rowPassesFilters',
  'buildResultRowHtml',
  'buildCompactCell'
]);
const panel = loadScript('src/ui/panel.js', [
  'shouldUseStandaloneHomePageMode',
  'cloneBeanListFormForRequests'
]);
const events = loadScript('src/ui/events.js', [
  'bindPanelEvents',
  'setPanelBodyCollapsed',
  'togglePanelBody',
  'togglePanelMaximized',
  'hidePanelToRestorePill',
  'restorePanelFromPill'
]);
const csv = loadScript('src/export/csv.js', ['exportHitsCsv', 'csvCell', 'formatDateForFile']);

test('panel template contains every runtime element exactly once', () => {
  const html = template.getPanelTemplate();
  const ids = [
    'panel', 'body', 'dragHandle', 'runtimeTitle', 'crmPersonSelect', 'crmDateRange',
    'loadCrmBtn', 'accountCol', 'eventCol', 'requestSource', 'startTime', 'endTime',
    'startBtn', 'stopBtn', 'exportBtn', 'clearBtn', 'resultBody', 'filterPopover',
    'filterPopoverList', 'filterPopoverApply'
  ];

  for (const id of ids) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
});

test('render helpers enforce required columns, valid times, filters, and HTML escaping', () => {
  globalThis.state = makeState();
  globalThis.els = initialEls;
  globalThis.state.rows = [{}];
  globalThis.state.results = [{ status: '命中' }];
  globalThis.state.autoDetected = { autoOk: false };

  assert.equal(render.detectColumn(['客户账户', '事件号'], ['客户账号', '客户账户']), '客户账户');
  assert.equal(render.detectColumn(['客户账号详情'], ['客户账号']), '客户账号详情');
  assert.equal(render.detectColumn(['其他'], ['客户账号']), '');
  assert.equal(render.canStartQuery(), false);
  render.updateButtons();
  assert.equal(globalThis.els.startBtn.disabled, true);
  assert.equal(globalThis.els.exportBtn.disabled, false);

  globalThis.state.autoDetected.autoOk = true;
  assert.equal(render.hasRequiredQueryColumns(), true);
  assert.equal(render.canStartQuery(), true);
  assert.equal(render.hasExportableResults(), true);

  globalThis.els.startTime.value = '2026-07-13T09:00';
  globalThis.els.endTime.value = '2026-07-13T10:00';
  const range = render.getSelectedTimeRange();
  assert.equal(render.formatDateTimeLocalInput(range.start), '2026-07-13T09:00');
  globalThis.els.startTime.value = '2026-07-13T11:00';
  assert.throws(() => render.getSelectedTimeRange(), /开始时间不能晚于结束时间/);

  globalThis.state.columnFilters = { trackerName: new Set(['张三']) };
  assert.equal(render.rowPassesFilters({ trackerName: '张三' }), true);
  assert.equal(render.rowPassesFilters({ trackerName: '李四' }), false);
  const html = render.buildResultRowHtml({
    status: '命中',
    eventNo: '<img src=x onerror=alert(1)>',
    account: '"quoted"',
    detail: "a'b"
  });
  assert.match(html, /result-hit/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&quot;quoted&quot;/);
  assert.match(html, /&#39;/);
});

test('CSV export applies active filters and neutralizes spreadsheet formulas', () => {
  const anchor = makeElement();
  let clicked = 0;
  let removed = 0;
  let appended = 0;
  anchor.click = () => { clicked++; };
  anchor.remove = () => { removed++; };
  globalThis.document = {
    createElement: tag => {
      assert.equal(tag, 'a');
      return anchor;
    },
    body: { appendChild: value => { assert.equal(value, anchor); appended++; } }
  };
  TestURL.created = [];
  TestURL.revoked = [];
  globalThis.state = makeState();
  globalThis.state.columnFilters = { trackerName: new Set(['张三']) };
  globalThis.state.results = [
    { status: '命中', eventNo: 'E1', trackerName: '张三', account: '=1+1', detail: 'a"b' },
    { status: '命中', eventNo: 'E2', trackerName: '李四', account: 'safe', detail: 'hidden' },
    { status: '未命中', eventNo: 'E3', trackerName: '张三' }
  ];
  globalThis.els = { log: makeElement() };

  csv.exportHitsCsv();
  assert.equal(TestURL.created.length, 1);
  const output = TestURL.created[0].parts.join('');
  assert.equal(output.startsWith('\uFEFF'), true);
  assert.match(output, /E1/);
  assert.doesNotMatch(output, /E2|E3/);
  assert.match(output, /"'=1\+1"/);
  assert.match(output, /"a""b"/);
  assert.equal(clicked, 1);
  assert.equal(removed, 1);
  assert.equal(appended, 1);
  assert.deepEqual(TestURL.revoked, ['blob:test']);
  assert.equal(csv.csvCell('  +SUM(A1:A2)'), '"\'  +SUM(A1:A2)"');
  assert.equal(csv.csvCell('\tvalue'), '"\'\tvalue"');
});

test('standalone form cloning preserves live control state', () => {
  const sourceFields = [
    { tagName: 'INPUT', type: 'text', value: 'live' },
    { tagName: 'INPUT', type: 'checkbox', checked: true },
    { tagName: 'INPUT', type: 'checkbox', checked: false },
    { tagName: 'SELECT', value: 'b' }
  ];
  const cloneFields = sourceFields.map((field, index) => ({
    tagName: field.tagName,
    type: field.type,
    value: index === 0 ? 'stale' : '',
    checked: false,
    attributes: new Map(index === 2 ? [['checked', 'checked']] : []),
    options: index === 3 ? [{ value: 'a', selected: true }, { value: 'b', selected: false }] : [],
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); }
  }));
  const clone = {
    id: '',
    style: {},
    attributes: new Map(),
    querySelectorAll: () => cloneFields,
    setAttribute(name, value) { this.attributes.set(name, value); }
  };
  const form = {
    id: '',
    cloneNode: () => clone,
    querySelectorAll: () => sourceFields
  };

  assert.equal(panel.shouldUseStandaloneHomePageMode(), true);
  assert.equal(panel.cloneBeanListFormForRequests(null), null);
  const result = panel.cloneBeanListFormForRequests(form);
  assert.equal(result.id, 'form1');
  assert.equal(result.style.display, 'none');
  assert.equal(result.attributes.get('data-jdbean-preserved-form'), '1');
  assert.equal(cloneFields[0].value, 'live');
  assert.equal(cloneFields[0].attributes.get('value'), 'live');
  assert.equal(cloneFields[1].checked, true);
  assert.equal(cloneFields[1].attributes.get('checked'), 'checked');
  assert.equal(cloneFields[2].attributes.has('checked'), false);
  assert.equal(cloneFields[3].value, 'b');
  assert.deepEqual(cloneFields[3].options.map(option => option.selected), [false, true]);
});

test('CRM organization parsing rejects dates and prefers the exact group', () => {
  assert.equal(local.isLikelyDeptId('234567'), true);
  assert.equal(local.isLikelyDeptId('20260713'), false);
  const ids = [];
  local.collectDeptIdsFromText('parDeptId="234567"&deptId=345678', ids);
  assert.deepEqual(Array.from(new Set(ids)), ['234567', '345678']);

  const jsonp = 'callback({"data":[{"name":"其他组","deptId":"345678"},{"name":"目标组","attributes":{"parDeptId":"234567"}},{"name":"日期节点","id":"20260713"}]})';
  assert.equal(source.parseLooseJsonPayload(jsonp).ok, true);
  assert.equal(source.pickDeptIdFromObject({ attributes: { parDeptId: '234567' } }), '234567');
  const hit = source.resolveDeptIdFromSources([{ name: 'tree', text: jsonp }], '目标组');
  assert.equal(hit.deptId, '234567');
  assert.equal(hit.label, '目标组');

  const endpoints = source.discoverCrmTreeEndpointUrls([{ text: [
    'url: "/monitor/businessMonitor/customDeptTree"',
    'url: "https://evil.example/deptTree"'
  ].join('\n') }], 'https://crm.jd.com/monitor/businessMonitor');
  assert.ok(endpoints.includes('https://crm.jd.com/monitor/businessMonitor/customDeptTree'));
  assert.equal(endpoints.every(value => new TestURL(value).hostname === 'crm.jd.com'), true);
});

test('CRM URL and tracker helpers normalize expected fields', () => {
  const normalized = new TestURL(source.normalizeCrmCaseCloseDetailUrl(
    'https://crm.jd.com/monitor/monitorCaseInfo/monitorDetail?deptId=234567&keep=1',
    '2026-07-13 00:00:00'
  ));
  assert.equal(normalized.searchParams.get('parDeptId'), '234567');
  assert.equal(normalized.searchParams.get('funName'), 'caseCloseCount');
  assert.equal(normalized.searchParams.get('flag'), 'all');
  assert.equal(normalized.searchParams.get('keep'), '1');
  assert.equal(source.extractCrmParDeptIdFromUrl(normalized.href), '234567');
  assert.equal(source.extractTrackerChineseName('zhangsan-张三'), '张三');
  assert.equal(source.extractTrackerErp('zhangsan-张三'), 'zhangsan');
  assert.equal(source.looksLikeLoginPage('<a href="https://login.jd.com">login</a>'), true);
  assert.match(source.findDirectCrmDetailUrlInText('/monitor/monitorCaseInfo/monitorDetail?parDeptId=234567'), /parDeptId=234567/);
});

test('CRM table parsing removes checkbox columns and deduplicates non-empty event numbers', () => {
  const header = (textContent, checkbox = false) => ({
    textContent,
    querySelector: selector => selector === 'input[type="checkbox"]' && checkbox ? {} : null
  });
  const headers = [header('选择', true), header('事件号'), header('事件号'), header('')];
  const row = values => ({ children: values.map(textContent => ({ textContent })) });
  const table = {
    querySelectorAll(selector) {
      if (selector === 'thead th') return headers;
      if (selector === 'tbody tr') return [
        row(['x', 'E1', 'A', 'tail']),
        row(['x', '', '', ''])
      ];
      return [];
    }
  };
  const parsed = local.parseCrmMonitorTable(table);
  assert.deepEqual(parsed.headers, ['事件号', '事件号']);
  assert.deepEqual(parsed.rows, [['E1', 'A']]);
  assert.deepEqual(local.buildUniqueHeaders(['事件号', '事件号', '']), ['事件号', '事件号_2', '列3']);

  const deduped = local.dedupeCrmRows({
    headers: ['事件号'],
    rows: [{ 事件号: 'E1' }, { 事件号: 'E1' }, { 事件号: '' }, { 事件号: '' }]
  });
  assert.deepEqual(deduped.rows, [{ 事件号: 'E1' }, { 事件号: '' }, { 事件号: '' }]);
});

test('CRM multipage loader explicitly replaces a non-first initial page', async () => {
  const requested = [];
  globalThis.location = { href: 'https://crm.jd.com/monitor/monitorCaseInfo/monitorDetail?pageNumber=3', origin: 'https://crm.jd.com' };
  globalThis.DOMParser = class { parseFromString(text) { return { page: text, scripts: [] }; } };
  globalThis.requestText = async () => 'initial-page-3';
  globalThis.getCrmParamsFromUrlAndDoc = () => ({});
  globalThis.getPreferredCrmPageSizeFromDoc = () => 2;
  globalThis.findCrmDataTable = doc => doc;
  globalThis.parseCrmMonitorTableObjects = table => ({ headers: ['事件号', '客户账户'], rows: [{ 事件号: table.page, 客户账户: table.page }] });
  globalThis.getCrmTotalCountFromDoc = () => 4;
  globalThis.getCurrentCrmPageSizeFromDoc = () => 2;
  globalThis.hasCrmRequiredHeader = () => true;
  globalThis.fetchCrmMonitorPage = async (_params, page) => {
    requested.push(page);
    return `page-${page}`;
  };
  globalThis.dedupeCrmRows = value => value;

  const result = await source.fetchCrmRowsFromDetailUrl(globalThis.location.href);
  assert.deepEqual(requested, [1, 2]);
  assert.deepEqual(result.rows.map(row => row['事件号']), ['page-1', 'page-2']);
});

test('CRM load failure restores the loading controls', async () => {
  const loadButton = makeElement();
  const dateRange = makeElement();
  const detectStatus = makeElement();
  const startButton = makeElement();
  const exportButton = makeElement();
  startButton.disabled = false;
  exportButton.disabled = false;
  globalThis.state = makeState();
  globalThis.els = {
    loadCrmBtn: loadButton,
    crmDateRange: dateRange,
    startBtn: startButton,
    exportBtn: exportButton,
    log: makeElement(),
    detectStatus
  };
  let updates = 0;
  globalThis.updateButtons = () => { updates++; };
  globalThis.canStartQuery = () => true;
  globalThis.getSelectedCrmDateRangeInfo = () => ({ optionLabel: '今天关闭量' });
  globalThis.resolveCrmDetailUrlHttpOnly = async () => { throw new Error('boom'); };

  await assert.rejects(source.loadCrmSourceData(), /boom/);
  assert.equal(globalThis.state.loadingCrm, false);
  assert.equal(loadButton.disabled, false);
  assert.equal(loadButton.textContent, '获取数据');
  assert.equal(loadButton.classList.contains('btn-loading'), false);
  assert.equal(detectStatus.classList.contains('loading'), false);
  assert.equal(dateRange.disabled, false);
  assert.equal(startButton.disabled, false);
  assert.equal(exportButton.disabled, false);
  assert.equal(updates, 2);
});

test('CRM local export falls back to the visible page and restores the button', async () => {
  const status = makeElement();
  globalThis.document = { getElementById: id => id === 'jdbeanLocalCrmExportStatus' ? status : null };
  globalThis.location = { href: 'https://crm.jd.com/monitor/monitorCaseInfo/monitorDetail' };
  globalThis.fetchCrmRowsFromDetailUrl = async () => { throw new Error('pagination failed'); };
  globalThis.findCrmDataTable = () => ({ table: true });
  globalThis.parseCrmMonitorTable = () => ({ headers: ['事件号'], rows: [['E1']] });
  let downloaded;
  globalThis.downloadCrmRowsAsExcel = (headers, rows) => { downloaded = { headers, rows }; };
  const button = makeElement();
  button.innerHTML = '<span>导出</span>';

  await local.exportCrmMonitorTableToLocal(button);
  assert.deepEqual(downloaded, { headers: ['事件号'], rows: [['E1']] });
  assert.match(status.textContent, /已导出当前页 1 条/);
  assert.equal(button.innerHTML, '<span>导出</span>');
  assert.equal(button.style.pointerEvents, '');
  assert.equal(button.style.opacity, '');
});

test('window controls update collapsed, maximized, hidden, and restored states', () => {
  globalThis.els = {
    body: makeElement(),
    toggleBtn: makeElement(),
    minimizeBtn: makeElement(),
    panel: makeElement(),
    zoomBtn: makeElement(),
    restoreBtn: makeElement()
  };
  globalThis.els.restoreBtn.classList.add('hidden');

  events.setPanelBodyCollapsed(true);
  assert.equal(globalThis.els.body.classList.contains('hidden'), true);
  assert.equal(globalThis.els.toggleBtn.textContent, '+');
  events.togglePanelBody();
  assert.equal(globalThis.els.body.classList.contains('hidden'), false);
  events.togglePanelMaximized();
  assert.equal(globalThis.els.panel.classList.contains('maximized'), true);
  events.hidePanelToRestorePill();
  assert.equal(globalThis.els.panel.classList.contains('hidden'), true);
  assert.equal(globalThis.els.restoreBtn.classList.contains('hidden'), false);
  events.restorePanelFromPill();
  assert.equal(globalThis.els.panel.classList.contains('hidden'), false);
  assert.equal(globalThis.els.restoreBtn.classList.contains('hidden'), true);
});
