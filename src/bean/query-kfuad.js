'use strict';

async function runBatchKfuad() {
  if (state.running || state.loadingCrm) return;
  if (state.crmData) syncCrmSelectionForRun();
  if (state.rows.length === 0) return;

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
  if (!timeRange.start || !timeRange.end) {
    alert('kfuad（新接口）必须同时指定开始时间与截止时间。');
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
  log(`开始查询(kfuad)：${state.sourceContext ? formatSourceContextForLog(state.sourceContext) : `${rowsForRun.length} 条`}｜账号 ${work.groups.length} 个｜并发 ${BEAN_QUERY_CONCURRENCY}｜分页并发 ${KFUAD_PAGINATION_CONCURRENCY}`);

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
      log(`查询中(kfuad)：账号 ${index + 1}/${work.groups.length}｜行 ${Math.min(state.stats.done + state.stats.skipped + 1, rowsForRun.length)}/${rowsForRun.length}`);
      const matches = await queryAllKfuadPagesCached(group.account, keyword, timeRange);
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
      console.debug('[京豆查询工具] kfuad 查询异常：', group.account, err);
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
    els.exportBtn.disabled = state.results.filter(r => r.status === '命中').length === 0;
    const finalText = state.stopped ? '已停止' : '查询完成';
    log(`${finalText}(kfuad)：命中 ${state.stats.hit}，未命中 ${state.stats.noHit}，异常 ${state.stats.error}，跳过 ${state.stats.skipped}。`);
  }
}

function buildKfuadCacheKey(account, keyword, timeRange) {
  const start = timeRange?.start ? timeRange.start.getTime() : '';
  const end = timeRange?.end ? timeRange.end.getTime() : '';
  return `kfuad|${clean(account)}|${clean(keyword)}|${start}|${end}`;
}

async function queryAllKfuadPagesCached(account, keyword, timeRange) {
  if (!state.beanQueryCache) state.beanQueryCache = new Map();
  const key = buildKfuadCacheKey(account, keyword, timeRange);
  if (state.beanQueryCache.has(key)) return state.beanQueryCache.get(key);
  const promise = queryAllKfuadPages(account, keyword, timeRange);
  promise.catch(() => {
    if (state.beanQueryCache.get(key) === promise) state.beanQueryCache.delete(key);
  });
  state.beanQueryCache.set(key, promise);
  return promise;
}

async function queryAllKfuadPages(account, keyword, timeRange) {
  const beginMs = timeRange.start.getTime();
  const endMs = timeRange.end.getTime();
  const firstPayload = await queryKfuadDetailBeans(account, beginMs, endMs, 1, KFUAD_QUERY_PAGE_SIZE);
  const firstPage = extractKfuadMatchesFromPayload(firstPayload, keyword, beginMs, endMs);
  const pageResults = [{ page: 1, matches: firstPage.matches }];
  const firstContent = Array.isArray(firstPayload?.content) ? firstPayload.content : [];
  const firstTotalPages = Number(firstPayload?.totalPages || 0);
  const maxPages = Math.min(firstTotalPages || KFUAD_QUERY_MAX_PAGES, KFUAD_QUERY_MAX_PAGES);
  if (maxPages <= 1 || firstPage.earlyStop || Boolean(firstPayload?.last) || firstContent.length < KFUAD_QUERY_PAGE_SIZE) {
    return firstPage.matches;
  }

  const batchSize = Math.max(1, KFUAD_PAGINATION_CONCURRENCY);
  let nextPage = 2;
  let stopAfterPage = Infinity;
  while (nextPage <= maxPages && nextPage <= stopAfterPage) {
    if (state.stopped) break;
    const batchPages = [];
    for (let i = 0; i < batchSize && nextPage <= maxPages; i++, nextPage++) {
      batchPages.push(nextPage);
    }
    const results = await Promise.all(batchPages.map(page => queryKfuadDetailBeans(account, beginMs, endMs, page, KFUAD_QUERY_PAGE_SIZE).then(payload => ({ page, payload }))));
    results.sort((a, b) => a.page - b.page);
    for (const { page, payload } of results) {
      const extracted = extractKfuadMatchesFromPayload(payload, keyword, beginMs, endMs);
      pageResults.push({ page, matches: extracted.matches });
      const content = Array.isArray(payload?.content) ? payload.content : [];
      const totalPages = Number(payload?.totalPages || 0);
      const isLast = Boolean(payload?.last) || content.length < KFUAD_QUERY_PAGE_SIZE;
      if (extracted.earlyStop || isLast || (totalPages > 0 && page >= totalPages)) {
        stopAfterPage = Math.min(stopAfterPage, page);
      }
    }
    await yieldToBrowser();
  }
  if (firstTotalPages > KFUAD_QUERY_MAX_PAGES) console.debug('[京豆查询工具] kfuad 页数过多，已限制查询：', account, firstTotalPages, KFUAD_QUERY_MAX_PAGES);

  return pageResults
    .filter(item => item.page <= stopAfterPage)
    .sort((a, b) => a.page - b.page)
    .flatMap(item => item.matches);
}

function extractKfuadMatchesFromPayload(payload, keyword, beginMs, endMs) {
  const matches = [];
  const content = Array.isArray(payload?.content) ? payload.content : [];
  const createTimes = [];
  for (const item of content) {
    const createMs = Number(item?.createDate || 0);
    if (Number.isFinite(createMs) && createMs > 0) createTimes.push(createMs);
    const inRange = createMs >= beginMs && createMs <= endMs;
    if (!inRange) continue;
    const userVisibleInfo = clean(item?.userVisibleInfo);
    const memo = clean(item?.memo);
    if (!matchesBeanKeyword(userVisibleInfo, keyword) && !matchesBeanKeyword(memo, keyword)) continue;
    matches.push(buildKfuadMatch(item));
  }
  // Only stop when the entire page is older than the requested range. A mixed
  // boundary page must not suppress later pages if the upstream ordering is
  // temporarily unstable.
  const earlyStop = createTimes.length > 0 && createTimes.every(createMs => createMs < beginMs);
  return { matches, earlyStop };
}

function buildKfuadMatch(item) {
  const createTime = formatKfuadTimestamp(item?.createDate);
  const userVisibleInfo = clean(item?.userVisibleInfo);
  const memo = clean(item?.memo);
  const detail = userVisibleInfo || memo;
  return {
    businessNo: clean(item?.businessBill1),
    businessNo1: clean(item?.businessBill2),
    createTime,
    amount: item?.amount != null ? String(item.amount) : '',
    activityId: clean(item?.topBusinessId),
    activityName: clean(item?.secondBusinessId),
    detail,
    sourceLink: ''
  };
}

function formatKfuadTimestamp(ms) {
  const n = Number(ms || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  if (!Number.isFinite(d.getTime())) return '';
  return formatDateTimeSeconds(d);
}

async function queryKfuadDetailBeans(account, beginMs, endMs, pageNo, pageSize) {
  const bodyObj = {
    pin: account,
    dataSource: '1',
    detailType: null,
    beginDate: beginMs,
    endDate: endMs,
    pageNo,
    pageSize
  };
  const body = JSON.stringify(bodyObj);
  return runWithRetry(async () => {
    const resp = await sendRuntimeMessageSafe({
      type: 'JD_BEAN_TOOL_FETCH_TEXT',
      url: KFUAD_DETAIL_BEANS_URL,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'Accept': 'application/json, text/plain, */*'
        },
        body,
        credentials: 'include',
        timeoutMs: 30000
      }
    }, 30000);
    if (!resp || !resp.ok) {
      const err = new Error(resp?.error || `kfuad 请求失败 HTTP ${resp?.status || 'unknown'}`);
      throw err;
    }
    const text = resp.text || '';
    let json;
    try {
      json = JSON.parse(text);
    } catch (_err) {
      if (looksLikeLoginPage(text)) throw new Error('kfuad 登录态失效，请先在浏览器打开 kfuad.jd.com 完成登录。');
      throw new Error('kfuad 返回内容无法解析为 JSON。');
    }
    if (json && Number(json.code) !== 200) {
      const msg = clean(json.message) || `code ${json.code}`;
      if (/login|登录|未登录/i.test(msg)) throw new Error('kfuad 登录态失效，请先在浏览器打开 kfuad.jd.com 完成登录。');
      throw new Error(`kfuad 接口返回错误：${msg}`);
    }
    return json && json.result ? json.result : { content: [], totalPages: 0, last: true };
  });
}
