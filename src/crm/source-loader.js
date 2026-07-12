'use strict';

async function loadCrmSourceData() {
  if (!state || state.running || state.loadingCrm) return;

  const previousStartDisabled = els.startBtn.disabled;
  const previousExportDisabled = els.exportBtn.disabled;
  let committed = false;

  state.loadingCrm = true;
  updateButtons();
  els.loadCrmBtn.disabled = true;
  els.loadCrmBtn.classList.add('btn-loading');
  els.loadCrmBtn.textContent = '读取中';
  if (els.crmDateRange) els.crmDateRange.disabled = true;
  els.startBtn.disabled = true;
  els.exportBtn.disabled = true;
  const pendingInfo = getSelectedCrmDateRangeInfo();
  const pendingText = `正在读取 ${pendingInfo.optionLabel}，请耐心等待…`;
  els.log.textContent = pendingText;
  els.detectStatus.textContent = pendingText;
  els.detectStatus.classList.add('loading');
  try {
    const rangeInfo = getSelectedCrmDateRangeInfo();
    const detailInfo = await resolveCrmDetailUrlHttpOnly(rangeInfo);
    const detailUrl = normalizeCrmCaseCloseDetailUrl(detailInfo.url, rangeInfo.beginTimeStr);
    const detail = new URL(detailUrl, location.href);
    const label = detailInfo.label || '当前CRM组';
    const dateText = describeCrmDateFromUrl(detail, rangeInfo);
    log(`读取中：${dateText}`);

    const data = await fetchCrmRowsFromDetailUrl(detailUrl, (page, pages, total) => {
      const pageText = pages > 1 ? `读取中：${dateText}｜${page}/${pages}` : `读取中：${dateText}`;
      log(pageText);
      els.detectStatus.textContent = pageText;
    });
    const creatorInfo = filterIgnoredCreators(data.rows);
    const trackerCol = detectColumn(data.headers, TRACKER_COL_CANDIDATES);
    const rows = creatorInfo.rows.map(row => {
      const copy = { ...row };
      copy.__trackerName = trackerCol ? extractTrackerChineseName(row[trackerCol]) : '';
      copy.__trackerErp = trackerCol ? extractTrackerErp(row[trackerCol]) : '';
      return copy;
    });
    state.crmData = {
      label,
      url: detailUrl,
      dateText,
      headers: data.headers,
      rows,
      ignored: creatorInfo.ignored,
      trackerCol,
      dateRangeMode: rangeInfo.mode,
      beginTimeStr: rangeInfo.beginTimeStr,
      parDeptId: detail.searchParams.get('parDeptId') || detailInfo.parDeptId || ''
    };
    fillCrmPersonSelect(state.crmData);
    applyCrmPersonSelection();
    log(`${dateText}｜可查询 ${rows.length} 条`);
    if (!trackerCol) console.debug('[京豆查询工具] 未识别到追踪人列，只能按整组查询。');
    committed = true;
  } finally {
    state.loadingCrm = false;
    els.loadCrmBtn.disabled = false;
    els.loadCrmBtn.classList.remove('btn-loading');
    els.loadCrmBtn.textContent = '获取数据';
    els.detectStatus.classList.remove('loading');
    if (els.crmDateRange) els.crmDateRange.disabled = false;
    updateButtons();
    if (!committed) {
      els.startBtn.disabled = previousStartDisabled || state.running || !canStartQuery();
      els.exportBtn.disabled = previousExportDisabled;
    }
  }
}

async function resolveCrmDetailUrlHttpOnly(rangeInfo = getCrmDateRangeInfo()) {
  log('读取CRM数据...');
  const detailInfo = await resolveCrmDetailUrlFromBusinessMonitorHtml(rangeInfo);
  if (detailInfo?.url) return detailInfo;
  throw new Error('后台HTTP请求未能识别当前组关闭明细链接：CRM业务监控页返回内容中未找到当前组 parDeptId。');
}

async function resolveCrmDetailUrlFromBusinessMonitorHtml(rangeInfo = getCrmDateRangeInfo()) {
  const businessUrl = 'https://crm.jd.com/monitor/businessMonitor';
  const html = await requestText(businessUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    errorPrefix: '读取CRM业务监控页失败'
  });
  if (looksLikeLoginPage(html)) {
    throw new Error('CRM业务监控页返回登录页，请先确认当前浏览器已登录CRM。');
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const groupInfo = resolveCrmBusinessGroupInfo(doc, html);
  const label = groupInfo.label || '当前CRM组';
  const sources = [{ name: 'businessMonitor HTML', url: businessUrl, text: html }];

  const direct = findDirectCrmDetailUrl(doc) || findDirectCrmDetailUrlInText(html);
  if (direct) return { url: normalizeCrmCaseCloseDetailUrl(direct, rangeInfo.beginTimeStr), label, count: groupInfo.count || '', parDeptId: extractCrmParDeptIdFromUrl(direct) };

  const immediateDeptId = groupInfo.parDeptId || discoverCrmParDeptId(doc, label, html);
  if (immediateDeptId) {
    return { url: buildCrmCaseCloseDetailUrl(immediateDeptId, rangeInfo.beginTimeStr), label, count: groupInfo.count || '', parDeptId: immediateDeptId };
  }

  const scriptSources = await collectBusinessMonitorScripts(doc, businessUrl);
  sources.push(...scriptSources);

  const staticHit = resolveDeptIdFromSources(sources, label);
  if (staticHit?.deptId && (staticHit.score || 0) >= 50) {
    return { url: buildCrmCaseCloseDetailUrl(staticHit.deptId, rangeInfo.beginTimeStr), label: staticHit.label || label, count: groupInfo.count || '', parDeptId: staticHit.deptId };
  }

  const endpointUrls = discoverCrmTreeEndpointUrls(sources, businessUrl);
  if (endpointUrls.length) console.debug('[京豆查询工具] 探测CRM后台树接口数量：', endpointUrls.length);

  const tried = [];
  for (const endpointUrl of endpointUrls) {
    const methods = [
      { method: 'GET' },
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01'
        },
        body: ''
      }
    ];
    for (const req of methods) {
      const tag = `${req.method} ${endpointUrl}`;
      tried.push(tag);
      try {
        const text = await requestText(endpointUrl, {
          method: req.method,
          headers: req.headers || { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/html, */*; q=0.01' },
          body: req.body,
          errorPrefix: '读取CRM组织树接口失败'
        });
        if (looksLikeLoginPage(text)) continue;
        const directFromEndpoint = findDirectCrmDetailUrlInText(text);
        if (directFromEndpoint) return { url: normalizeCrmCaseCloseDetailUrl(directFromEndpoint, rangeInfo.beginTimeStr), label, count: groupInfo.count || '', parDeptId: extractCrmParDeptIdFromUrl(directFromEndpoint) };
        const hit = resolveDeptIdFromSources([{ name: tag, url: endpointUrl, text }], label);
        if (hit?.deptId) {
          console.debug('[京豆查询工具] 已识别parDeptId：', hit.label || label, hit.deptId);
          return { url: buildCrmCaseCloseDetailUrl(hit.deptId, rangeInfo.beginTimeStr), label: hit.label || label, count: groupInfo.count || '', parDeptId: hit.deptId };
        }
      } catch (err) {
      }
    }
  }

  const suffix = tried.length ? `已尝试接口：${tried.slice(0, 8).join('；')}${tried.length > 8 ? '；...' : ''}` : '未在页面脚本中发现可探测的组织树接口。';
  throw new Error(`后台HTTP请求未能识别当前组parDeptId。${suffix}`);
}

function looksLikeLoginPage(text) {
  const s = String(text || '').slice(0, 8000).toLowerCase();
  return s.includes('login.jd.com') || s.includes('passport.jd.com') || s.includes('idp.jd.com') || /用户登录|扫码登录|账号登录/.test(s);
}

function findDirectCrmDetailUrlInText(text) {
  const m = String(text || '').match(/https?:\\?\/\\?\/crm\.jd\.com\\?\/monitor\\?\/monitorCaseInfo\\?\/monitorDetail[^'"<>\s\\]+/i)
    || String(text || '').match(/\/monitor\/monitorCaseInfo\/monitorDetail\?[^'"<>\s\\]+/i);
  if (!m) return '';
  const raw = m[0].replace(/\\\//g, '/');
  return new URL(decodeHtmlAttr(raw), 'https://crm.jd.com').href;
}

async function collectBusinessMonitorScripts(doc, baseUrl) {
  const out = [];
  const scripts = Array.from(doc.querySelectorAll('script'));
  for (const script of scripts) {
    const inline = script.textContent || '';
    if (inline && /businessGroupTreeData|urlTargetAll|caseCloseCount|parDeptId|deptId|monitor/.test(inline)) {
      out.push({ name: 'inline script', url: baseUrl, text: inline });
    }
    const src = script.getAttribute('src');
    if (!src) continue;
    let abs = '';
    try { abs = new URL(src, baseUrl).href; } catch (_) { continue; }
    if (!/^https:\/\/crm\.jd\.com\//i.test(abs) && !/^https:\/\/storage\.360buyimg\.com\//i.test(abs)) continue;
    try {
      const text = await requestText(abs, {
        method: 'GET',
        headers: { 'Accept': 'application/javascript,text/javascript,*/*;q=0.8' },
        credentials: getCredentialsModeForUrl(abs),
        errorPrefix: '读取CRM脚本失败'
      });
      if (/businessGroupTreeData|urlTargetAll|caseCloseCount|parDeptId|deptId|monitor|businessGroup|tree/i.test(text)) {
        out.push({ name: `script ${abs}`, url: abs, text });
      }
    } catch (err) {
    }
  }
  return out;
}

function discoverCrmTreeEndpointUrls(sources, baseUrl) {
  const found = new Map();
  const add = (raw, score = 0) => {
    if (!raw) return;
    let value = String(raw).replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
    if (!value || value === '#' || value.startsWith('javascript:')) return;
    if (!/^(https?:)?\/\//.test(value) && !value.startsWith('/')) {
      if (!/^[A-Za-z0-9_./?=&%-]+$/.test(value) || !/(businessGroup|BusinessGroup|dept|Dept|tree|Tree|org|Org|organ|Organ)/.test(value)) return;
    }
    let href = '';
    try { href = new URL(value, baseUrl).href; } catch (_) { return; }
    if (!/^https:\/\/crm\.jd\.com\//i.test(href)) return;
    const lower = href.toLowerCase();
    let s = score;
    if (/tree|businessgroup|group|dept|org|organ/.test(lower)) s += 40;
    if (/businessmonitor/.test(lower)) s += 20;
    if (/monitorcaseinfo|monitorcommon|monitordetail/.test(lower)) s -= 30;
    const old = found.get(href);
    if (!old || old.score < s) found.set(href, { href, score: s });
  };

  for (const source of sources || []) {
    const text = String(source.text || '');
    const regexes = [
      /(?:url|href)\s*[:=]\s*["']([^"']*(?:businessGroup|BusinessGroup|dept|Dept|tree|Tree|org|Org|organ|Organ)[^"']*)["']/g,
      /(?:\$\.getJSON|\$\.get|\$\.post)\s*\(\s*["']([^"']+)["']/g,
      /["'](\/monitor\/[^"']*(?:businessGroup|BusinessGroup|dept|Dept|tree|Tree|org|Org|organ|Organ)[^"']*)["']/g,
      /["'](https:\/\/crm\.jd\.com\/monitor\/[^"']+)["']/g
    ];
    for (const re of regexes) {
      let m;
      while ((m = re.exec(text))) add(m[1], 10);
    }
  }

  const guesses = [
    '/monitor/businessMonitor/getBusinessGroupTreeData',
    '/monitor/businessMonitor/queryBusinessGroupTreeData',
    '/monitor/businessMonitor/getBusinessGroupTree',
    '/monitor/businessMonitor/queryBusinessGroupTree',
    '/monitor/businessMonitor/getDeptTree',
    '/monitor/businessMonitor/queryDeptTree',
    '/monitor/businessMonitor/getOrgTree',
    '/monitor/businessMonitor/queryOrgTree',
    '/monitor/businessMonitor/getBusinessGroup',
    '/monitor/businessMonitor/queryBusinessGroup',
    '/monitor/businessMonitor/loadBusinessGroupTree',
    '/monitor/businessMonitor/treeData',
    '/monitor/businessMonitor/queryTreeData',
    '/monitor/businessMonitor/getMonitorTree'
  ];
  guesses.forEach(u => add(u, 1));

  return Array.from(found.values())
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.href.localeCompare(b.href))
    .slice(0, 28)
    .map(x => x.href);
}

function resolveDeptIdFromSources(sources, expectedLabel = '') {
  const candidates = [];
  for (const source of sources || []) {
    const text = String(source.text || '');
    const direct = [];
    collectDeptIdsFromText(text, direct, { broad: false });
    const label = findLikelyBusinessGroupLabel(text);
    if (direct.length) {
      direct.forEach((deptId, i) => candidates.push({ deptId, label: label || expectedLabel, score: label ? 50 : 15, order: i, source: source.name }));
    }
    extractDeptCandidatesFromStructuredText(text, expectedLabel, source.name).forEach(c => candidates.push(c));
  }
  return chooseBestDeptCandidate(candidates, expectedLabel);
}

function extractDeptCandidatesFromStructuredText(text, expectedLabel = '', sourceName = '') {
  const out = [];
  const raw = String(text || '').trim();
  const parsed = parseLooseJsonPayload(raw);
  let order = 0;

  const visit = (value, pathLabel = '') => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, pathLabel);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const name = clean(value.name || value.text || value.title || value.label || value.deptName || value.orgName || value.departmentName || value.businessGroupName || '');
    const deptId = pickDeptIdFromObject(value);
    const mergedLabel = name || pathLabel;
    if (deptId) {
      out.push({ deptId, label: mergedLabel || expectedLabel, score: scoreDeptCandidate(mergedLabel, expectedLabel, sourceName), order: order++, source: sourceName });
    }
    const childLabel = mergedLabel || pathLabel;
    for (const key of ['children', 'childrens', 'nodes', 'data', 'rows', 'result', 'list', 'treeData', 'businessGroupTreeData']) {
      if (value[key] !== undefined) visit(value[key], childLabel);
    }
  };

  if (parsed.ok) visit(parsed.value);

  const arrayOrObjectBlocks = raw.match(/(?:\[[\s\S]{0,20000}\]|\{[\s\S]{0,20000}\})/g) || [];
  for (const block of arrayOrObjectBlocks.slice(0, 20)) {
    const p = parseLooseJsonPayload(block);
    if (p.ok) visit(p.value);
  }

  const groupLabel = clean(expectedLabel);
  const labelRegex = groupLabel ? escapeRegExp(groupLabel) : '[\\u4e00-\\u9fa5A-Za-z0-9_-]{2,30}组';
  const nearRe = new RegExp(`.{0,600}${labelRegex}.{0,600}`, 'g');
  let m;
  while ((m = nearRe.exec(raw))) {
    const ids = [];
    collectDeptIdsFromText(m[0], ids, { broad: false });
    ids.forEach((deptId, i) => out.push({ deptId, label: groupLabel || findLikelyBusinessGroupLabel(m[0]), score: 65, order: order++ + i, source: sourceName }));
  }

  return out;
}

function parseLooseJsonPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false };
  const tries = [raw];
  const assign = raw.match(/=\s*([\[{][\s\S]*[\]}])\s*;?\s*$/);
  if (assign) tries.push(assign[1]);
  const callback = raw.match(/^[\w$.]+\s*\(\s*([\[{][\s\S]*[\]}])\s*\)\s*;?$/);
  if (callback) tries.push(callback[1]);
  for (const item of tries) {
    try { return { ok: true, value: JSON.parse(item) }; } catch (_) {}
  }
  return { ok: false };
}

function pickDeptIdFromObject(obj) {
  const keys = ['parDeptId', 'parDeptID', 'deptId', 'deptID', 'curDeptId', 'curDeptID', 'orgId', 'organId', 'businessGroupId', 'id', 'value', 'key'];
  for (const key of keys) {
    const value = obj && obj[key];
    const m = clean(value).match(/^\d{4,12}$/);
    if (m && isLikelyDeptId(m[0])) return m[0];
  }
  const attrs = obj && (obj.attributes || obj.attr || obj.dataMap || obj.extra || obj.ext || obj.data);
  if (attrs && attrs !== obj && typeof attrs === 'object' && !Array.isArray(attrs)) {
    return pickDeptIdFromObject(attrs);
  }
  return '';
}

function scoreDeptCandidate(label, expectedLabel, sourceName) {
  const l = clean(label);
  const e = clean(expectedLabel);
  const source = String(sourceName || '').toLowerCase();
  let score = 20;
  if (/tree|businessgroup|dept|org|organ/.test(source)) score += 20;
  if (e && l === e) score += 100;
  else if (e && l && (l.includes(e) || e.includes(l))) score += 80;
  if (/组$/.test(l)) score += 25;
  return score;
}

function chooseBestDeptCandidate(candidates, expectedLabel = '') {
  const deduped = [];
  const seen = new Set();
  for (const c of candidates || []) {
    const deptId = clean(c.deptId);
    if (!isLikelyDeptId(deptId)) continue;
    const key = `${deptId}|${clean(c.label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...c, deptId });
  }
  if (!deduped.length) return null;
  deduped.sort((a, b) => (b.score || 0) - (a.score || 0) || (a.order || 0) - (b.order || 0));
  const expected = clean(expectedLabel);
  if (expected) {
    const exact = deduped.find(c => clean(c.label) === expected);
    if (exact) return exact;
    const fuzzy = deduped.find(c => clean(c.label) && (clean(c.label).includes(expected) || expected.includes(clean(c.label))));
    if (fuzzy) return fuzzy;
  }
  return deduped[0];
}

async function fetchCrmRowsFromDetailUrl(detailUrl, onProgress) {
  const detail = new URL(detailUrl, location.href);
  const html = await requestText(detail.href, { method: 'GET', errorPrefix: '读取CRM详情页失败' });
  const detailDoc = new DOMParser().parseFromString(html, 'text/html');
  const params = getCrmParamsFromUrlAndDoc(detail, detailDoc);
  const configuredPageSize = getPreferredCrmPageSizeFromDoc(detailDoc);

  let firstDoc = detailDoc;
  let firstTable = findCrmDataTable(firstDoc);
  let firstParsed = firstTable ? parseCrmMonitorTableObjects(firstTable) : { headers: [], rows: [] };
  let total = getCrmTotalCountFromDoc(firstDoc);
  let pageSize = getCurrentCrmPageSizeFromDoc(firstDoc) || configuredPageSize;
  let fetchedFirstPage = false;

  if (!firstParsed.rows.length || !hasCrmRequiredHeader(firstParsed.headers)) {
    pageSize = configuredPageSize;
    onProgress && onProgress(1, 1, total);
    const firstHtml = await fetchCrmMonitorPage(params, 1, pageSize, detail.origin);
    firstDoc = new DOMParser().parseFromString(firstHtml, 'text/html');
    firstTable = findCrmDataTable(firstDoc);
    if (!firstTable) throw new Error('CRM数据接口返回中未找到可识别的数据表格');
    firstParsed = parseCrmMonitorTableObjects(firstTable);
    total = getCrmTotalCountFromDoc(firstDoc) || total || firstParsed.rows.length;
    pageSize = getCurrentCrmPageSizeFromDoc(firstDoc) || pageSize || firstParsed.rows.length || 100;
    fetchedFirstPage = true;
  }

  total = total || firstParsed.rows.length;
  pageSize = Math.max(1, pageSize || configuredPageSize || 100);
  let pages = Math.max(1, Math.ceil(total / pageSize));

  // The initial detail URL can represent any currently selected page. For a
  // multi-page result set, explicitly load page 1 before assembling all pages.
  if (pages > 1 && !fetchedFirstPage) {
    onProgress && onProgress(1, pages, total);
    const firstHtml = await fetchCrmMonitorPage(params, 1, pageSize, detail.origin);
    firstDoc = new DOMParser().parseFromString(firstHtml, 'text/html');
    firstTable = findCrmDataTable(firstDoc);
    if (!firstTable) throw new Error('CRM第 1 页返回中未找到可识别的数据表格');
    firstParsed = parseCrmMonitorTableObjects(firstTable);
    total = getCrmTotalCountFromDoc(firstDoc) || total || firstParsed.rows.length;
    pageSize = Math.max(1, getCurrentCrmPageSizeFromDoc(firstDoc) || pageSize || firstParsed.rows.length || 100);
    pages = Math.max(1, Math.ceil(total / pageSize));
  }

  if (pages <= 1 && firstParsed.rows.length >= total) {
    return dedupeCrmRows(firstParsed);
  }

  const allRows = [];
  let headers = firstParsed.headers;
  for (let page = 1; page <= pages; page++) {
    onProgress && onProgress(page, pages, total);
    let pageData;
    if (page === 1) {
      pageData = firstParsed;
    } else {
      const pageHtml = await fetchCrmMonitorPage(params, page, pageSize, detail.origin);
      const pageDoc = new DOMParser().parseFromString(pageHtml, 'text/html');
      const table = findCrmDataTable(pageDoc);
      if (!table) throw new Error(`CRM第 ${page} 页返回中未找到可识别的数据表格`);
      pageData = parseCrmMonitorTableObjects(table);
    }
    headers = pageData.headers.length ? pageData.headers : headers;
    allRows.push(...pageData.rows);
  }

  return dedupeCrmRows({ headers, rows: allRows });
}

function getCrmParamsFromUrlAndDoc(url, doc) {
  const params = {};
  for (const [key, value] of url.searchParams.entries()) params[key] = value;
  const keys = ['flag', 'parDeptId', 'curDeptId', 'userPin', 'master', 'funName', 'caseType', 'closeBeg', 'closeEnd', 'beginTimeStr', 'remindBizType'];
  const scripts = Array.from(doc.scripts || []).map(s => s.textContent || '').join('\n');
  for (const key of keys) {
    if (params[key] !== undefined) continue;
    const re = new RegExp(key + "\\s*:\\s*[\"']([^\"']*)[\"']");
    const m = scripts.match(re);
    params[key] = m ? m[1] : '';
  }
  return params;
}

function parseCrmMonitorTableObjects(table) {
  const parsed = parseCrmMonitorTable(table);
  const headers = buildUniqueHeaders(parsed.headers);
  const rows = parsed.rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = clean(row[i] ?? ''); });
    return obj;
  }).filter(obj => Object.values(obj).some(Boolean));
  return { headers, rows };
}

function filterIgnoredCreators(rows) {
  const kept = [];
  let ignored = 0;
  for (const row of rows || []) {
    const creator = getRowValueByCandidates(row, CREATOR_COL_CANDIDATES);
    if (shouldIgnoreCreator(creator)) ignored++;
    else kept.push(row);
  }
  return { rows: kept, ignored };
}

function getRowValueByCandidates(row, candidates) {
  if (!row) return '';
  const headers = Object.keys(row).filter(k => !k.startsWith('__'));
  const col = detectColumn(headers, candidates);
  return col ? clean(row[col]) : '';
}

function shouldIgnoreCreator(value) {
  const v = clean(value);
  if (!v) return false;
  const normalized = v.toLowerCase();
  if (IGNORED_CREATORS.has(normalized)) return true;
  return Array.from(IGNORED_CREATORS).some(name => normalized.includes(name));
}

function extractTrackerChineseName(value) {
  const s = clean(value);
  if (!s) return '';
  const parts = s.split(/[-—_]/).map(x => clean(x)).filter(Boolean);
  const tail = parts.length > 1 ? parts[parts.length - 1] : s;
  const chinese = tail.match(/[\u4e00-\u9fa5·]{2,}/g);
  if (chinese && chinese.length) return chinese.join('');
  const anyChinese = s.match(/[\u4e00-\u9fa5·]{2,}/g);
  return anyChinese && anyChinese.length ? anyChinese.join('') : '';
}

function getTrackerNameFromRow(row) {
  const cached = clean(row?.__trackerName);
  if (cached) return extractTrackerChineseName(cached);
  const raw = getRowValueByCandidates(row, TRACKER_COL_CANDIDATES);
  return extractTrackerChineseName(raw);
}

function extractTrackerErp(value) {
  const s = clean(value);
  if (!s) return '';
  const m = s.match(/[A-Za-z][A-Za-z0-9_.]*/);
  return m ? m[0] : '';
}

function getTrackerErpFromRow(row) {
  const cached = clean(row?.__trackerErp);
  if (cached) return cached;
  const raw = getRowValueByCandidates(row, TRACKER_COL_CANDIDATES);
  return extractTrackerErp(raw);
}

function describeCrmDateFromUrl(url, rangeInfo = null) {
  if (rangeInfo?.statusDateText) return rangeInfo.statusDateText;
  const begin = url.searchParams.get('beginTimeStr') || '';
  const m = begin.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '按URL时间范围';
}

function getSelectedCrmDateRangeInfo() {
  const mode = els?.crmDateRange?.value || state?.crmDateRangeMode || CRM_DATE_RANGE_TODAY;
  const info = getCrmDateRangeInfo(mode);
  if (state) state.crmDateRangeMode = info.mode;
  return info;
}

function normalizeCrmCaseCloseDetailUrl(url, beginTimeStr) {
  const target = new URL(url, 'https://crm.jd.com');
  target.searchParams.set('flag', target.searchParams.get('flag') || 'all');
  target.searchParams.set('funName', 'caseCloseCount');
  if (!target.searchParams.get('parDeptId')) {
    const deptId = target.searchParams.get('deptId') || target.searchParams.get('cfgDeptId') || target.searchParams.get('curDeptId');
    if (deptId) target.searchParams.set('parDeptId', deptId);
  }
  target.searchParams.set('beginTimeStr', beginTimeStr || getCrmDateRangeInfo(CRM_DATE_RANGE_TODAY).beginTimeStr);
  return target.href;
}

function extractCrmParDeptIdFromUrl(url) {
  try {
    const target = new URL(url, 'https://crm.jd.com');
    return clean(target.searchParams.get('parDeptId') || target.searchParams.get('deptId') || target.searchParams.get('cfgDeptId') || target.searchParams.get('curDeptId') || '');
  } catch (_) {
    return '';
  }
}

function normalizeCredentialsMode(value, fallback = 'include') {
  return ['include', 'omit', 'same-origin'].includes(value) ? value : fallback;
}

function getCredentialsModeForUrl(url) {
  const target = url instanceof URL ? url : new URL(url, location.href);
  if (target.hostname === 'storage.360buyimg.com') return 'omit';
  return 'include';
}

async function requestText(url, options = {}) {
  const target = new URL(url, location.href);
  const method = String(options.method || 'GET').toUpperCase();
  const headers = options.headers || undefined;
  const body = options.body || undefined;
  const credentials = normalizeCredentialsMode(options.credentials, getCredentialsModeForUrl(target));
  const timeoutMs = Number(options.timeoutMs || 30000);
  const errorPrefix = options.errorPrefix || '请求失败';

  const canUseBackground = target.origin !== location.origin;
  if (canUseBackground) {
    return runWithRetry(async () => {
      const resp = await sendRuntimeMessageSafe({
        type: 'JD_BEAN_TOOL_FETCH_TEXT',
        url: target.href,
        options: { method, headers, body, credentials, timeoutMs }
      }, timeoutMs);
      if (!resp || !resp.ok) {
        throw new Error(resp?.error || `${errorPrefix}: HTTP ${resp?.status || 'unknown'}`);
      }
      return resp.text || '';
    });
  }

  return runWithRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1000), 120000));
    try {
      const res = await fetch(target.href, { method, credentials, headers, body, signal: controller.signal });
      if (!res.ok) throw new Error(`${errorPrefix}: HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  });
}
