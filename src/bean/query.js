'use strict';

async function runBatchDispatch() {
  const source = state && state.requestSource ? state.requestSource : DEFAULT_REQUEST_SOURCE;
  if (source === REQUEST_SOURCE_KFUAD) return runBatchKfuad();
  return runBatch();
}

async function runBatch() {
  if (state.running || state.loadingCrm) return;
  if (state.crmData) syncCrmSelectionForRun();
  if (state.rows.length === 0) return;
  if (!hasRequiredQueryColumns()) {
    alert('未能识别客户账户列或事件号列，请重新读取CRM数据。');
    return;
  }

  const form = state.beanListForm || findBeanListForm();
  if (form && !state.beanListForm) state.beanListForm = form;
  if (!form) {
    alert('当前页面未找到京豆查询表单，请确认已打开 /tool/beanList 页面。');
    return;
  }

  const accountCol = els.accountCol.value;
  const eventCol = els.eventCol.value;
  const keyword = DEFAULT_KEYWORD;
  let timeRange;
  try {
    timeRange = getSelectedTimeRange();
  } catch (err) {
    alert(err.message || String(err));
    return;
  }

  state.running = true;
  state.stopped = false;
  state.results = [];
  state.beanQueryCache = new Map();
  clearResultsView();
  resetStats();

  const rowsForRun = (state.rows || []).slice();
  state.stats.total = rowsForRun.length;
  renderStats(true);
  updateButtons();

  const work = buildAccountWorkItems(rowsForRun, accountCol, eventCol);
  const requestTemplate = createBeanListRequestTemplate(form);
  log(`开始查询：${state.sourceContext ? formatSourceContextForLog(state.sourceContext) : `${rowsForRun.length} 条`}｜账号 ${work.groups.length} 个｜并发 ${BEAN_QUERY_CONCURRENCY}`);

  let renderedSinceYield = 0;
  const noteRendered = async (count = 1) => {
    renderedSinceYield += count;
    if (renderedSinceYield < UI_YIELD_EVERY_ROWS) return;
    renderedSinceYield = 0;
    flushResultsNow();
    await yieldToBrowser();
  };

  for (const item of work.skipped) {
    if (state.stopped) break;
    state.stats.skipped++;
    appendSkippedResultForRow(item.row, item.detail);
    await noteRendered();
  }
  renderStats(true);

  const processGroup = async (group, index) => {
    if (state.stopped) return;

    try {
      log(`查询中：账号 ${index + 1}/${work.groups.length}｜行 ${Math.min(state.stats.done + state.stats.skipped + 1, rowsForRun.length)}/${rowsForRun.length}`);
      const matches = await queryAllBeanPagesCached(requestTemplate, group.account, keyword, timeRange);
      if (state.stopped) return;
      state.stats.done += group.rows.length;
      if (matches.length) {
        state.stats.hit += matches.length * group.rows.length;
        await noteRendered(appendMatchResultsForRows(group.rows, matches));
      } else {
        state.stats.noHit += group.rows.length;
        await noteRendered(appendNoHitResultsForRows(group.rows));
      }
    } catch (err) {
      if (state.stopped) return;
      state.stats.done += group.rows.length;
      state.stats.error += group.rows.length;
      await noteRendered(appendErrorResultsForRows(group.rows, err));
      console.debug('[京豆查询工具] 查询异常：', group.account, err);
    }
    renderStats();
  };

  try {
    await runConcurrentTasks(work.groups, BEAN_QUERY_CONCURRENCY, processGroup);
  } finally {
    flushResultsNow();
    await yieldToBrowser();
    state.running = false;
    renderStats(true);
    updateButtons();
    const finalText = state.stopped ? '已停止' : '查询完成';
    log(`${finalText}：命中 ${state.stats.hit}，未命中 ${state.stats.noHit}，异常 ${state.stats.error}，跳过 ${state.stats.skipped}。`);
  }
}

function buildAccountWorkItems(rows, accountCol, eventCol) {
  const skipped = [];
  const groupByAccount = new Map();

  for (const inputRow of rows || []) {
    const row = createQueryRowContext(inputRow, accountCol, eventCol);
    const skipDetail = getQueryRowSkipDetail(row);
    if (skipDetail) {
      skipped.push({ row, detail: skipDetail });
      continue;
    }

    let group = groupByAccount.get(row.account);
    if (!group) {
      group = { account: row.account, rows: [] };
      groupByAccount.set(row.account, group);
    }
    group.rows.push(row);
  }

  return {
    skipped,
    groups: Array.from(groupByAccount.values())
  };
}

function createQueryRowContext(inputRow, accountCol, eventCol) {
  return {
    account: clean(inputRow[accountCol]),
    eventNo: clean(inputRow[eventCol]),
    trackerName: getTrackerNameFromRow(inputRow),
    trackerErp: getTrackerErpFromRow(inputRow),
    creator: getRowValueByCandidates(inputRow, CREATOR_COL_CANDIDATES)
  };
}

function getQueryRowSkipDetail(row) {
  if (shouldIgnoreCreator(row.creator)) return '无需查询';
  if (!row.account) return '客户账户为空';
  return '';
}

function appendSkippedResultForRow(row, detail) {
  appendResult({
    status: '跳过',
    eventNo: row.eventNo,
    trackerName: row.trackerName,
    trackerErp: row.trackerErp,
    account: row.account,
    beanCreateTime: '',
    detail
  });
}

function appendNoHitResultsForRows(rows) {
  for (const row of rows) {
    appendResult({
      status: '未命中',
      eventNo: row.eventNo,
      trackerName: row.trackerName,
      trackerErp: row.trackerErp,
      account: row.account,
      beanCreateTime: '',
      detail: NO_BEAN_RECORD_DETAIL
    });
  }
  return rows.length;
}

function appendErrorResultsForRows(rows, err) {
  const detail = err && err.message ? err.message : String(err);
  for (const row of rows) {
    appendResult({
      status: '异常',
      eventNo: row.eventNo,
      trackerName: row.trackerName,
      trackerErp: row.trackerErp,
      account: row.account,
      beanCreateTime: '',
      detail
    });
  }
  return rows.length;
}

function appendMatchResultsForRows(rows, matches) {
  let count = 0;
  for (const row of rows) {
    for (const m of matches) {
      appendResult({
        status: '命中',
        eventNo: row.eventNo,
        trackerName: row.trackerName,
        trackerErp: row.trackerErp,
        account: row.account,
        beanCreateTime: m.createTime,
        beanAmount: m.amount,
        businessNo: m.businessNo,
        businessNo1: m.businessNo1,
        activityId: m.activityId,
        activityName: m.activityName,
        detail: m.detail,
        sourceLink: m.sourceLink
      });
      count++;
    }
  }
  return count;
}

function createBeanListRequestTemplate(form) {
  const action = form.action || new URL('/tool/beanList', location.origin).href;
  const params = new URLSearchParams();
  const fd = new FormData(form);
  for (const [key, val] of fd.entries()) {
    if (typeof val === 'string') params.append(key, val);
  }
  return { action, params };
}

function buildBeanQueryCacheKey(account, keyword, timeRange) {
  const start = timeRange?.start ? timeRange.start.getTime() : '';
  const end = timeRange?.end ? timeRange.end.getTime() : '';
  return `${clean(account)}|${clean(keyword)}|${start}|${end}`;
}

async function queryAllBeanPagesCached(requestTemplate, account, keyword, timeRange) {
  if (!state.beanQueryCache) state.beanQueryCache = new Map();
  const key = buildBeanQueryCacheKey(account, keyword, timeRange);
  if (state.beanQueryCache.has(key)) return state.beanQueryCache.get(key);
  const promise = queryAllBeanPages(requestTemplate, account, keyword, timeRange);
  promise.catch(() => {
    if (state.beanQueryCache.get(key) === promise) state.beanQueryCache.delete(key);
  });
  state.beanQueryCache.set(key, promise);
  return promise;
}

async function queryAllBeanPages(requestTemplate, account, keyword, timeRange) {
  const firstHtml = await queryBeanList(requestTemplate, account, 1);
  const matches = extractBeanMatches(firstHtml, keyword, timeRange);
  const totalPages = getTotalPages(firstHtml);
  const maxPages = Math.min(totalPages, BEAN_QUERY_MAX_PAGES);
  if (maxPages <= 1 || shouldStopBeanPaging(firstHtml, timeRange)) {
    if (totalPages > maxPages) console.debug('[京豆查询工具] 页数过多，已限制查询：', account, totalPages, maxPages);
    return matches;
  }

  const batchSize = Math.max(1, BEAN_PAGINATION_CONCURRENCY);
  let nextPage = 2;
  while (nextPage <= maxPages) {
    if (state.stopped) break;
    const batchPages = [];
    for (let i = 0; i < batchSize && nextPage <= maxPages; i++, nextPage++) {
      batchPages.push(nextPage);
    }
    const results = await Promise.all(batchPages.map(page => queryBeanList(requestTemplate, account, page).then(html => ({ page, html }))));
    results.sort((a, b) => a.page - b.page);
    let earlyStop = false;
    for (const { html } of results) {
      matches.push(...extractBeanMatches(html, keyword, timeRange));
      if (shouldStopBeanPaging(html, timeRange)) earlyStop = true;
    }
    if (earlyStop) break;
    await yieldToBrowser();
  }
  if (totalPages > maxPages) console.debug('[京豆查询工具] 页数过多，已限制查询：', account, totalPages, maxPages);
  return matches;
}

async function queryBeanList(requestTemplate, account, pageIndex = 1) {
  const action = requestTemplate.action;
  const body = new URLSearchParams(requestTemplate.params);
  body.set('pin', account);
  body.set('pageIndex', String(pageIndex));
  const bodyString = body.toString();

  return runWithRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BEAN_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(action, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html, */*; q=0.01' },
        body: bodyString,
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (!html || !html.includes('sample-table-2')) {
        if (html.includes('登录') || html.toLowerCase().includes('login')) throw new Error('可能登录失效或无权限');
        throw new Error('返回页面未找到京豆列表');
      }
      return html;
    } finally {
      clearTimeout(timer);
    }
  });
}

function getTotalPages(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const val = doc.querySelector('#totalPage')?.getAttribute('value') || doc.querySelector('#totalPage')?.value || '1';
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function extractBeanMatches(html, keyword, timeRange) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('#sample-table-2') || Array.from(doc.querySelectorAll('table')).find(t => t.textContent.includes('详细说明'));
  if (!table) throw new Error('未找到结果表');

  const headers = Array.from(table.querySelectorAll('thead th')).map(th => clean(th.textContent));
  const idx = (names, fallback) => {
    for (const name of names) {
      const n = normalizeText(name);
      const found = headers.findIndex(h => normalizeText(h).includes(n));
      if (found >= 0) return found;
    }
    return fallback;
  };

  const iBusinessNo = idx(['业务编号'], 0);
  const iCreateTime = idx(['创建时间'], 1);
  const iAmount = idx(['收入/支出'], 2);
  const iActivityId = idx(['活动ID'], 4);
  const iActivityName = idx(['活动名称'], 5);
  const iDetail = idx(['详细说明'], 6);
  const iBusinessNo1 = idx(['业务编号1'], 7);

  const out = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const cells = Array.from(tr.querySelectorAll('td')).map(td => clean(td.textContent));
    if (!cells.length) continue;
    const detail = cells[iDetail] || '';
    if (!matchesBeanKeyword(detail, keyword)) continue;
    const createTime = cells[iCreateTime] || '';
    if (!isCreateTimeInRange(createTime, timeRange)) continue;
    const link = tr.querySelector('a[href]');
    out.push({
      businessNo: cells[iBusinessNo] || '',
      createTime,
      amount: cells[iAmount] || '',
      activityId: cells[iActivityId] || '',
      activityName: cells[iActivityName] || '',
      detail,
      businessNo1: cells[iBusinessNo1] || '',
      sourceLink: link ? link.href : ''
    });
  }
  return out;
}

function shouldStopBeanPaging(html, timeRange) {
  if (!timeRange || !timeRange.start) return false;
  const times = extractBeanPageCreateTimes(html).filter(Boolean);
  if (!times.length) return false;
  return times.every(dt => dt.getTime() < timeRange.start.getTime());
}

function extractBeanPageCreateTimes(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('#sample-table-2') || Array.from(doc.querySelectorAll('table')).find(t => t.textContent.includes('创建时间'));
  if (!table) return [];
  const headers = Array.from(table.querySelectorAll('thead th')).map(th => clean(th.textContent));
  let iCreateTime = headers.findIndex(h => normalizeText(h).includes('创建时间'));
  if (iCreateTime < 0) iCreateTime = 1;
  return Array.from(table.querySelectorAll('tbody tr')).map(tr => {
    const cells = Array.from(tr.querySelectorAll('td')).map(td => clean(td.textContent));
    return parseBeanCreateTime(cells[iCreateTime] || '');
  });
}

function isCreateTimeInRange(createTime, range) {
  if (!range || (!range.start && !range.end)) return true;
  const parsed = parseBeanCreateTime(createTime);
  if (!parsed) return false;
  const ts = parsed.getTime();
  if (range.start && ts < range.start.getTime()) return false;
  if (range.end && ts > range.end.getTime()) return false;
  return true;
}

function parseBeanCreateTime(v) {
  const s = clean(v);
  if (!s) return null;
  let m = s.match(/(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?\s*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?/);
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
    return isExactLocalDateTime(dt, y, mo, d, h, mi, se) ? dt : null;
  }
  m = s.match(/(\d{4})(\d{2})(\d{2})\s*(\d{2})?(\d{2})?(\d{2})?/);
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
    return isExactLocalDateTime(dt, y, mo, d, h, mi, se) ? dt : null;
  }
  const dt = new Date(s.replace(/-/g, '/'));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function isExactLocalDateTime(dt, year, month, day, hour, minute, second) {
  return Number.isFinite(dt.getTime())
    && dt.getFullYear() === Number(year)
    && dt.getMonth() === Number(month) - 1
    && dt.getDate() === Number(day)
    && dt.getHours() === Number(hour)
    && dt.getMinutes() === Number(minute)
    && dt.getSeconds() === Number(second);
}
