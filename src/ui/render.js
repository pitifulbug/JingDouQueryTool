'use strict';

function renderRuntimeTitle() {
  if (!els || !els.runtimeTitle) return;
  const envText = 'Manifest V3';
  let name = '京豆查询工具';
  let version = '';
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
      const manifest = chrome.runtime.getManifest() || {};
      name = clean(manifest.name || name);
      version = clean(manifest.version || '');
    }
  } catch (err) {
    name = '京豆查询工具';
  }
  const versionText = version ? ` v${version}` : '';
  els.runtimeTitle.textContent = `${name}${versionText}｜运行环境：${envText}`;
}

function log(msg) {
  if (!els.log) return;
  els.log.textContent = clean(msg || '');
}

function toFriendlyError(err) {
  const raw = clean(err && err.message ? err.message : err);
  if (isExtensionContextInvalidatedText(raw)) return EXTENSION_CONTEXT_INVALIDATED_TEXT;
  if (/cors|access-control-allow-origin|credentials/i.test(raw)) return '跨域静态资源读取失败，请确认插件已重新加载扩展。';
  if (/abort|timeout|timed out|signal is aborted/i.test(raw)) return '请求超时，请稍后重试或确认系统页面可正常打开。';
  if (/登录页|登录|login|passport|idp/i.test(raw)) return '登录态失效，请先确认当前浏览器已登录CRM。';
  if (/parDeptId|关闭明细链接|组织树|业务监控页/.test(raw)) return '未能自动识别当前组关闭数据，请确认CRM业务监控页有权限且能正常访问。';
  if (/HTTP\s*\d+/i.test(raw)) return raw.match(/HTTP\s*\d+/i)[0] + '，请求失败。';
  return raw || '未知错误';
}

function resetStats() {
  state.stats = { total: 0, done: 0, hit: 0, noHit: 0, error: 0, skipped: 0 };
  renderStats();
}

function renderStats(immediate = false) {
  if (!state || !els) return;
  if (state.running && !immediate) {
    if (state.statsRenderScheduled) return;
    state.statsRenderScheduled = true;
    const raf = window.requestAnimationFrame || (cb => window.setTimeout(cb, 16));
    raf(() => {
      state.statsRenderScheduled = false;
      renderStats(true);
    });
    return;
  }
  els.sTotal.textContent = state.stats.total;
  els.sDone.textContent = state.stats.done;
  els.sHit.textContent = state.stats.hit;
  els.sNoHit.textContent = state.stats.noHit;
  els.sError.textContent = state.stats.error;
  els.sSkipped.textContent = state.stats.skipped;
  const pct = state.stats.total ? Math.round((state.stats.done + state.stats.skipped) * 100 / state.stats.total) : 0;
  els.bar.style.width = `${Math.min(100, pct)}%`;
}

function renderColumns() {
  const fill = (select, selected) => {
    select.innerHTML = '';
    for (const h of state.headers) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      if (h === selected) opt.selected = true;
      select.appendChild(opt);
    }
  };

  const accountPrimary = detectColumn(state.headers, ['客户账户', '客户账号', '客户帐号', '客户帐户', '用户账号', '用户帐号', '用户账户', '客户名称', '账号名', '账户名', '账号', '用户pin', '用户PIN', '客户pin', '客户PIN', 'PIN', 'pin', '会员账号', '买家账号']);
  const accountFallback = accountPrimary || detectColumn(state.headers, ['事件线索', '订单账号', '订单用户']);
  const eventCol = detectColumn(state.headers, ['事件号', '事件编号', '事件ID', 'caseId', 'CASEID', 'case id', '工单号', '服务单号', '投诉单号', '问题单号', '单号']);
  const accountCol = accountFallback || state.headers[0] || '';
  const selectedEventCol = eventCol || state.headers[0] || '';

  fill(els.accountCol, accountCol);
  fill(els.eventCol, selectedEventCol);

  const autoOk = Boolean(accountPrimary && eventCol);
  state.autoDetected = { autoOk, accountCol, eventCol: selectedEventCol };
  if (autoOk) {
    els.detectStatus.textContent = `已自动识别：客户账户列「${accountPrimary}」，事件号列「${eventCol}」。`;
  } else {
    const missing = [accountPrimary ? '' : '客户账户', eventCol ? '' : '事件号'].filter(Boolean).join('、');
    els.detectStatus.textContent = `未能识别${missing || '必要'}列，请检查数据来源。`;
  }
}

function detectColumn(headers, candidates) {
  const normalized = headers.map(h => ({ raw: h, text: normalizeText(h).toLowerCase() }));
  for (const c of candidates) {
    const n = normalizeText(c).toLowerCase();
    const exact = normalized.find(h => h.text === n);
    if (exact) return exact.raw;
  }
  for (const c of candidates) {
    const n = normalizeText(c).toLowerCase();
    const fuzzy = normalized.find(h => h.text.includes(n) || n.includes(h.text));
    if (fuzzy) return fuzzy.raw;
  }
  return '';
}

function refreshCrmDateRangeOptions() {
  if (!els || !els.crmDateRange) return;
  const selected = els.crmDateRange.value || state.crmDateRangeMode || CRM_DATE_RANGE_TODAY;
  const todayInfo = getCrmDateRangeInfo(CRM_DATE_RANGE_TODAY);
  const yesterdayTodayInfo = getCrmDateRangeInfo(CRM_DATE_RANGE_YESTERDAY_TODAY);
  const labels = {
    [CRM_DATE_RANGE_TODAY]: todayInfo.optionLabel,
    [CRM_DATE_RANGE_YESTERDAY_TODAY]: yesterdayTodayInfo.optionLabel
  };
  Array.from(els.crmDateRange.options || []).forEach(option => {
    if (labels[option.value]) option.textContent = labels[option.value];
  });
  els.crmDateRange.value = selected;
}

function resetCrmLoadedDataForRangeChange() {
  if (!state || state.running) return;
  const info = getSelectedCrmDateRangeInfo();
  state.crmDateRangeMode = info.mode;
  state.rows = [];
  state.headers = [];
  state.results = [];
  state.crmData = null;
  state.sourceContext = null;
  state.beanQueryCache = new Map();
  els.accountCol.innerHTML = '';
  els.eventCol.innerHTML = '';
  els.crmPersonSelect.innerHTML = '<option value="">请先读取数据</option>';
  els.crmPersonSelect.disabled = true;
  clearResultsView();
  resetStats();
  renderSourceSummary();
  els.startBtn.disabled = true;
  els.exportBtn.disabled = true;
  refreshCrmDateRangeOptions();
  els.detectStatus.textContent = `数据日期：${info.optionLabel}`;
  log(`数据日期：${info.optionLabel}`);
}

function initDataSourceControls() {
  els.crmPersonSelect.innerHTML = '<option value="">请先读取数据</option>';
  els.crmPersonSelect.disabled = true;
  if (els.crmDateRange) els.crmDateRange.value = state.crmDateRangeMode || CRM_DATE_RANGE_TODAY;
  if (els.requestSource) {
    els.requestSource.value = state.requestSource || DEFAULT_REQUEST_SOURCE;
    state.requestSource = els.requestSource.value;
  }
  refreshCrmDateRangeOptions();
  const info = getSelectedCrmDateRangeInfo();
  els.detectStatus.textContent = `数据日期：${info.optionLabel}`;
}

function fillCrmPersonSelect(data) {
  const counts = new Map();
  for (const row of data.rows) {
    const name = clean(row.__trackerName);
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  els.crmPersonSelect.innerHTML = '';
  const group = document.createElement('option');
  group.value = CRM_GROUP_ALL;
  group.textContent = `整组 - ${data.label}（${data.rows.length}条）`;
  els.crmPersonSelect.appendChild(group);
  Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN')).forEach(([name, count]) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name}（${count}条）`;
    els.crmPersonSelect.appendChild(opt);
  });
  els.crmPersonSelect.disabled = false;
}

function applyCrmPersonSelection() {
  const data = state.crmData;
  if (!data) return;
  const selected = els.crmPersonSelect.value || CRM_GROUP_ALL;
  const rows = selected === CRM_GROUP_ALL ? data.rows : data.rows.filter(row => clean(row.__trackerName) === selected);
  state.rows = rows;
  state.headers = data.headers;
  state.results = [];
  clearResultsView();
  resetStats();
  state.stats.total = rows.length;
  renderStats();
  renderColumns();
  const personText = selected === CRM_GROUP_ALL ? `整组 - ${data.label}` : selected;
  state.sourceContext = { mode: 'crm', label: data.label, dateText: data.dateText, personText, count: rows.length };
  renderSourceSummary();
  els.detectStatus.textContent = `${data.dateText}｜${personText}｜${rows.length} 条`;
  els.startBtn.disabled = !canStartQuery();
  els.exportBtn.disabled = true;
  log(`${personText}｜${rows.length} 条`);
}

function getCrmRowsForCurrentSelection() {
  const data = state.crmData;
  if (!data) return state.rows || [];
  const selected = els.crmPersonSelect.value || CRM_GROUP_ALL;
  return selected === CRM_GROUP_ALL ? data.rows : data.rows.filter(row => clean(row.__trackerName) === selected);
}

function syncCrmSelectionForRun() {
  if (!state.crmData) return;
  const selected = els.crmPersonSelect.value || CRM_GROUP_ALL;
  const rows = getCrmRowsForCurrentSelection();
  state.rows = rows;
  state.headers = state.crmData.headers;
  const personText = selected === CRM_GROUP_ALL ? `整组 - ${state.crmData.label}` : selected;
  state.sourceContext = {
    mode: 'crm',
    label: state.crmData.label,
    dateText: state.crmData.dateText,
    personText,
    count: rows.length
  };
  renderSourceSummary();
}

function renderSourceSummary() {
  if (!state.sourceContext) {
    els.sourceSummary.textContent = '当前来源：未选择。';
    return;
  }
  els.sourceSummary.textContent = `当前来源：${formatSourceContextForLog(state.sourceContext)}`;
}

function formatSourceContextForLog(ctx) {
  return `${ctx.dateText}｜${ctx.personText}｜${ctx.count} 条`;
}

function hasRequiredQueryColumns() {
  return Boolean(state && state.autoDetected && state.autoDetected.autoOk);
}

function canStartQuery() {
  return Boolean(state && state.rows && state.rows.length > 0 && hasRequiredQueryColumns());
}

function hasExportableResults() {
  return Boolean(state && state.results && state.results.some(item => item.status === '命中'));
}

function updateButtons() {
  const busy = state.running || state.loadingCrm;
  els.startBtn.disabled = busy || !canStartQuery();
  els.stopBtn.disabled = !state.running;
  els.exportBtn.disabled = busy || !hasExportableResults();
  els.loadCrmBtn.disabled = busy;
  els.crmPersonSelect.disabled = busy || !state.crmData;
  if (els.crmDateRange) els.crmDateRange.disabled = busy;
  if (els.requestSource) els.requestSource.disabled = busy;
  els.accountCol.disabled = busy;
  els.eventCol.disabled = busy;
  els.startTime.disabled = busy;
  els.endTime.disabled = busy;
  if (els.clearBtn) els.clearBtn.disabled = busy;
}

function applyDefaultTimeRange() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(end.getDate() - 5);
  els.startTime.value = formatDateTimeLocalInput(start);
  els.endTime.value = formatDateTimeLocalInput(end);
}

function formatDateTimeLocalInput(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getSelectedTimeRange() {
  const startRaw = els.startTime.value;
  const endRaw = els.endTime.value;
  const start = parseDateTimeInput(startRaw);
  const end = parseDateTimeInput(endRaw);
  if (startRaw && !start) throw new Error('开始时间格式不正确');
  if (endRaw && !end) throw new Error('结束时间格式不正确');
  if (start && end && start.getTime() > end.getTime()) throw new Error('开始时间不能晚于结束时间');
  return { start, end };
}

function parseDateTimeInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatTimeRangeForLog(range) {
  const start = range.start ? formatDateTime(range.start) : '不限';
  const end = range.end ? formatDateTime(range.end) : '不限';
  return `${start} 至 ${end}`;
}

function formatDateTime(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const RESULT_COLUMNS = [
  { key: 'status', label: '状态' },
  { key: 'eventNo', label: '事件号' },
  { key: 'trackerName', label: '追踪人' },
  { key: 'trackerErp', label: 'ERP' },
  { key: 'account', label: '客户账户' },
  { key: 'beanCreateTime', label: '京豆创建时间' }
];

function getColumnValue(item, key) {
  return String(item && item[key] != null ? item[key] : '');
}

function rowPassesFilters(item) {
  const filters = state.columnFilters;
  if (!filters) return true;
  for (const key of Object.keys(filters)) {
    const set = filters[key];
    if (!set) continue;
    if (!set.has(getColumnValue(item, key))) return false;
  }
  return true;
}

function appendResult(item) {
  state.results.push(item);
  if (rowPassesFilters(item)) {
    state.resultRenderQueue.push(buildResultRowHtml(item));
    scheduleResultFlush();
  }
}

function rerenderResultsFromState() {
  if (!state || !els.resultBody) return;
  state.resultRenderQueue = [];
  state.resultRenderScheduled = false;
  const htmls = [];
  for (const item of state.results) {
    if (rowPassesFilters(item)) htmls.push(buildResultRowHtml(item));
  }
  els.resultBody.innerHTML = htmls.join('');
  updateFilterIndicators();
}

function updateFilterIndicators() {
  if (!root) return;
  const filters = state.columnFilters || {};
  root.querySelectorAll('.th-filter').forEach(btn => {
    const key = btn.dataset.colKey;
    btn.classList.toggle('active', filters[key] instanceof Set);
  });
}

function openFilterPopover(colKey, anchorBtn) {
  const col = RESULT_COLUMNS.find(c => c.key === colKey);
  if (!col || !els.filterPopover) return;

  const counts = new Map();
  for (const item of state.results) {
    const v = getColumnValue(item, colKey);
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const entries = Array.from(counts.entries()).sort((a, b) => {
    if (colKey === 'beanCreateTime') return a[0].localeCompare(b[0]);
    return a[0].localeCompare(b[0], 'zh-Hans-CN');
  });

  const current = state.columnFilters && state.columnFilters[colKey];
  state.filterPopoverCol = colKey;
  state.filterPopoverEntries = entries;
  state.filterPopoverSelected = new Set(current instanceof Set ? current : entries.map(([v]) => v));

  els.filterPopoverTitle.textContent = `筛选：${col.label}`;
  els.filterPopoverSearch.value = '';
  renderFilterPopoverList('');
  positionFilterPopover(anchorBtn);
  els.filterPopover.classList.remove('hidden');
  els.filterPopoverSearch.focus();
}

function closeFilterPopover() {
  if (!els.filterPopover) return;
  els.filterPopover.classList.add('hidden');
  state.filterPopoverCol = null;
  state.filterPopoverEntries = null;
  state.filterPopoverSelected = null;
  state.filterPopoverVisibleValues = null;
}

function renderFilterPopoverList(searchText) {
  const list = els.filterPopoverList;
  if (!list) return;
  const entries = state.filterPopoverEntries || [];
  const search = clean(searchText).toLowerCase();
  const filtered = search ? entries.filter(([v]) => v.toLowerCase().includes(search)) : entries;
  const selected = state.filterPopoverSelected;
  const allChecked = filtered.length > 0 && filtered.every(([v]) => selected.has(v));
  state.filterPopoverVisibleValues = filtered.map(([v]) => v);

  let html = `<label class="filter-item filter-item-all"><input type="checkbox" data-all="1"${allChecked ? ' checked' : ''}><span class="filter-item-text">(全选)</span></label>`;
  filtered.forEach(([v, count], idx) => {
    const display = v === '' ? '(空白)' : v;
    const checked = selected.has(v) ? ' checked' : '';
    html += `<label class="filter-item" title="${escapeHtml(display)}"><input type="checkbox" data-idx="${idx}"${checked}><span class="filter-item-text">${escapeHtml(display)}</span><span class="filter-item-count">${count}</span></label>`;
  });
  if (!filtered.length) html += '<div class="filter-empty">(无匹配项)</div>';
  list.innerHTML = html;
}

function getCurrentFilteredEntryValues() {
  return Array.isArray(state.filterPopoverVisibleValues) ? state.filterPopoverVisibleValues : [];
}

function positionFilterPopover(anchor) {
  if (!anchor || !els.filterPopover) return;
  const rect = anchor.getBoundingClientRect();
  const popover = els.filterPopover;
  popover.style.visibility = 'hidden';
  popover.classList.remove('hidden');
  const popRect = popover.getBoundingClientRect();
  let left = rect.left;
  if (left + popRect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popRect.width - 8);
  let top = rect.bottom + 4;
  if (top + popRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - popRect.height - 4);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = '';
}

function applyFilterPopoverSelection() {
  const colKey = state.filterPopoverCol;
  if (!colKey) return;
  if (!state.columnFilters) state.columnFilters = {};
  const allValues = (state.filterPopoverEntries || []).map(([v]) => v);
  const selected = state.filterPopoverSelected;
  if (selected.size === allValues.length) {
    delete state.columnFilters[colKey];
  } else {
    state.columnFilters[colKey] = new Set(selected);
  }
  closeFilterPopover();
  rerenderResultsFromState();
}

function clearFilterForCurrentColumn() {
  const colKey = state.filterPopoverCol;
  if (!colKey) return;
  if (state.columnFilters) delete state.columnFilters[colKey];
  closeFilterPopover();
  rerenderResultsFromState();
}

function buildResultRowHtml(item) {
  const status = item.status || '';
  const rowClass = status === '命中' ? 'result-hit' : status === '未命中' ? 'result-nohit' : status === '异常' ? 'result-error' : 'result-skipped';
  const badgeClass = status === '命中' ? 'badge-hit' : status === '未命中' ? 'badge-nohit' : status === '异常' ? 'badge-error' : 'badge-skipped';
  return `
    <tr class="${rowClass}">
      <td title="${escapeHtml(status)}"><span class="badge ${badgeClass}">${escapeHtml(status)}</span></td>
      ${buildCompactCell(item.eventNo || '')}
      ${buildCompactCell(item.trackerName || '')}
      ${buildCompactCell(item.trackerErp || '')}
      ${buildCompactCell(item.account || '')}
      ${buildCompactCell(item.beanCreateTime || '')}
      ${buildCompactCell(item.detail || '', '', true)}
    </tr>
  `;
}

function buildCompactCell(value, titleSuffix = '', multiline = false) {
  const text = String(value ?? '');
  const title = text || titleSuffix ? ` title="${escapeHtml(text + titleSuffix)}"` : '';
  const cellClass = multiline ? 'result-cell result-cell-multiline' : 'result-cell';
  return `<td${title}><span class="${cellClass}">${escapeHtml(text)}</span></td>`;
}

function scheduleResultFlush() {
  if (!state || state.resultRenderScheduled) return;
  state.resultRenderScheduled = true;
  const raf = window.requestAnimationFrame || (cb => window.setTimeout(cb, 16));
  raf(() => {
    state.resultRenderScheduled = false;
    flushPendingResults(RESULT_RENDER_BATCH_SIZE);
    if (state.resultRenderQueue.length) scheduleResultFlush();
  });
}

function flushPendingResults(maxRows = Infinity) {
  if (!state || !els.resultBody || !state.resultRenderQueue.length) return;
  const rows = state.resultRenderQueue.splice(0, maxRows);
  els.resultBody.insertAdjacentHTML('beforeend', rows.join(''));
}

function flushResultsNow() {
  if (!state) return;
  flushPendingResults(Infinity);
  state.resultRenderScheduled = false;
}

function clearResultsView() {
  if (state) {
    state.resultRenderQueue = [];
    state.resultRenderScheduled = false;
    state.columnFilters = {};
    closeFilterPopover();
  }
  if (els.resultBody) els.resultBody.textContent = '';
  updateFilterIndicators();
}

async function yieldAfterResultBatch(counter) {
  if (counter % UI_YIELD_EVERY_ROWS !== 0) return;
  flushResultsNow();
  await yieldToBrowser();
}

function makeDraggable() {
  if (state && state.appMode) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  els.dragHandle.addEventListener('mousedown', e => {
    if (e.target && e.target.closest && e.target.closest('button, .window-dots')) return;
    if (els.panel.classList.contains('maximized')) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = els.panel.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    els.panel.style.transform = 'none';
    els.panel.style.left = `${startLeft}px`;
    els.panel.style.top = `${startTop}px`;
    els.panel.style.right = 'auto';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const maxLeft = Math.max(0, window.innerWidth - els.panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - els.panel.offsetHeight);
    els.panel.style.left = `${Math.min(maxLeft, Math.max(0, startLeft + dx))}px`;
    els.panel.style.top = `${Math.min(maxTop, Math.max(0, startTop + dy))}px`;
  });
  window.addEventListener('mouseup', () => { dragging = false; });
}
