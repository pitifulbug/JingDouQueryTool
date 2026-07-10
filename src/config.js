'use strict';

const DEFAULT_KEYWORD = '满意度调研发放京豆';
const EXCLUDED_KEYWORDS = ['在线机器人满意度调研发放京豆'];
const IGNORED_CREATORS = new Set();
const CREATOR_COL_CANDIDATES = ['创建人', '创建人账号', '创建人erp', '创建人ERP', '创建者', '建单人', '登记人', '提交人'];
const TRACKER_COL_CANDIDATES = ['追踪人', '跟踪人', '跟进人', '追踪客服', '跟踪客服', '处理人', '责任人'];
const CRM_GROUP_ALL = '__GROUP_ALL__';
const RESULT_RENDER_BATCH_SIZE = 160;
const UI_YIELD_EVERY_ROWS = 10;
const BEAN_QUERY_MAX_PAGES = 20;
const BEAN_QUERY_CONCURRENCY = 6;
const BEAN_PAGINATION_CONCURRENCY = 4;
const BEAN_REQUEST_TIMEOUT_MS = 30000;
const NO_BEAN_RECORD_DETAIL = '未查询到满意度调研发放京豆记录';
const CRM_DATE_RANGE_TODAY = 'today';
const CRM_DATE_RANGE_YESTERDAY_TODAY = 'yesterday_today';
const REQUEST_SOURCE_JPOS = 'jpos';
const REQUEST_SOURCE_KFUAD = 'kfuad';
const DEFAULT_REQUEST_SOURCE = REQUEST_SOURCE_JPOS;
const KFUAD_DETAIL_BEANS_URL = 'https://kfuad.jd.com/platformApi/api/jingdou/detailBeans?lang=zh_CN';
const KFUAD_QUERY_PAGE_SIZE = 20;
const KFUAD_QUERY_MAX_PAGES = 50;
const KFUAD_PAGINATION_CONCURRENCY = 4;

let state = null;
let host = null;
let root = null;
let els = null;
let originalPageCache = null;

function createInitialState() {
  return {
  rows: [],
  headers: [],
  results: [],
  autoDetected: null,
  sourceContext: null,
  crmData: null,
  crmDateRangeMode: CRM_DATE_RANGE_TODAY,
  requestSource: DEFAULT_REQUEST_SOURCE,
  beanQueryCache: new Map(),
  beanListForm: null,
  appMode: false,
  loadingCrm: false,
  statsRenderScheduled: false,
  running: false,
  stopped: false,
  stats: { total: 0, done: 0, hit: 0, noHit: 0, error: 0, skipped: 0 },
  resultRenderQueue: [],
  resultRenderScheduled: false,
  columnFilters: {},
  filterPopoverCol: null,
  filterPopoverSelected: null,
  filterPopoverEntries: null,
  filterPopoverVisibleValues: null
};
}
