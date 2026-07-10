'use strict';

function isCrmMonitorPage() {
  return location.hostname === 'crm.jd.com' && location.pathname.indexOf('/monitor/monitorCaseInfo/monitorDetail') >= 0;
}

function findCrmBusinessGroupSpan(doc = document) {
  const preferred = doc.getElementById('businessGroupTreeData_1_span');
  if (preferred) return preferred;
  const treeSpans = Array.from(doc.querySelectorAll('[id^="businessGroupTreeData_"][id$="_span"]'));
  const labeled = treeSpans.find(el => /组$/.test(clean(el.textContent)));
  if (labeled) return labeled;
  if (treeSpans.length) return treeSpans.find(el => clean(el.textContent)) || treeSpans[0];
  return Array.from(doc.querySelectorAll('span')).find(el => /组$/.test(clean(el.textContent))) || null;
}

function findCrmCaseCloseLink(doc = document) {
  const links = Array.from(doc.querySelectorAll('a'));
  return links.find(a => /urlTargetAll\(["']caseCloseCount["']\)/.test(a.getAttribute('onclick') || '')) || null;
}

function resolveCrmBusinessGroupInfo(doc = document, htmlText = '') {
  const html = String(htmlText || doc.documentElement?.innerHTML || '');
  const span = findCrmBusinessGroupSpan(doc);
  const treeId = span?.id ? span.id.replace(/_span$/, '') : 'businessGroupTreeData_1';
  const labelFromDom = clean(span?.textContent || '');
  const labelFromHtml = (() => {
    const m = html.match(/id=["']businessGroupTreeData_1_span["'][^>]*>([^<]+)/i);
    return m ? clean(decodeHtmlAttr(m[1])) : '';
  })();
  const label = labelFromDom || labelFromHtml || findLikelyBusinessGroupLabel(html);
  const nearParts = [];

  if (treeId) {
    const idx = html.indexOf(treeId);
    if (idx >= 0) nearParts.push(html.slice(Math.max(0, idx - 3000), idx + 3000));
  }
  if (label) {
    const idx = html.indexOf(label);
    if (idx >= 0) nearParts.push(html.slice(Math.max(0, idx - 4000), idx + 4000));
  }
  const near = nearParts.join('\\n');
  const candidates = [];
  collectDeptIdsFromText(near, candidates, { broad: false });
  if (!candidates.length) collectDeptIdsFromText(html, candidates, { broad: false });
  if (!candidates.length) collectDeptIdsFromText(near || html, candidates, { broad: true });

  return {
    label,
    treeId,
    parDeptId: unique(candidates).find(Boolean) || '',
    count: findCrmCaseCloseCount(doc, html)
  };
}

function findLikelyBusinessGroupLabel(html) {
  const text = String(html || '');
  const group = text.match(/[\u4e00-\u9fa5A-Za-z0-9_-]{2,30}组/);
  return group ? clean(group[0]) : '';
}

function findCrmCaseCloseCount(doc, html) {
  const link = findCrmCaseCloseLink(doc);
  const domCount = clean(link?.textContent || '');
  if (domCount) return domCount;
  const m = String(html || '').match(/urlTargetAll\(["']caseCloseCount["']\)[^>]*>(\d+)/i);
  return m ? m[1] : '';
}

function buildCrmDetailUrlFromBusinessMonitorDoc(doc = document, groupLabel = '') {
  const direct = findDirectCrmDetailUrl(doc);
  if (direct) return direct;
  const deptId = discoverCrmParDeptId(doc, groupLabel);
  if (!deptId) return '';
  return buildCrmCaseCloseDetailUrl(deptId);
}

function findDirectCrmDetailUrl(doc) {
  const html = doc.documentElement?.innerHTML || '';
  const m = html.match(/https:\/\/crm\.jd\.com\/monitor\/monitorCaseInfo\/monitorDetail[^'"<>\s]+/);
  return m ? decodeHtmlAttr(m[0]) : '';
}

function discoverCrmParDeptId(doc, groupLabel = '', htmlText = '') {
  const group = findCrmBusinessGroupSpan(doc);
  const candidates = [];
  const push = (v) => {
    const m = clean(v).match(/\d{4,12}/);
    if (m && isLikelyDeptId(m[0])) candidates.push(m[0]);
  };

  for (let el = group; el && el !== doc.documentElement; el = el.parentElement) {
    push(el.getAttribute('parDeptId'));
    push(el.getAttribute('deptId'));
    push(el.getAttribute('data-par-dept-id'));
    push(el.getAttribute('data-dept-id'));
    push(el.dataset?.parDeptId);
    push(el.dataset?.deptId);
    push(el.getAttribute('onclick'));
    push(el.id);
  }

  const html = String(htmlText || doc.documentElement?.innerHTML || '');
  const label = clean(groupLabel || group?.textContent || '');
  if (label) {
    const idx = html.indexOf(label);
    if (idx >= 0) {
      const near = html.slice(Math.max(0, idx - 2500), idx + 2500);
      collectDeptIdsFromText(near, candidates, { broad: false });
    }
  }
  collectDeptIdsFromText(html, candidates, { broad: false });

  if (!candidates.length) collectDeptIdsFromText(html, candidates, { broad: true });
  return unique(candidates).find(Boolean) || '';
}

function collectDeptIdsFromText(text, out, options = {}) {
  const scoped = String(text || '');
  const patterns = [
    /(?:parDeptId|parDeptID|deptId|deptID|dept_id|orgId|organId|deptCode|id)\s*[:=]\s*["']?(\d{4,12})["']?/ig,
    /[?&](?:parDeptId|deptId|orgId|organId)=(\d{4,12})/ig,
    /urlTargetAll\([^)]*?(\d{4,12})/ig
  ];
  if (options.broad) patterns.push(/\b(2\d{4,8})\b/g);
  for (const re of patterns) {
    let m;
    while ((m = re.exec(scoped))) {
      const id = clean(m[1]);
      if (isLikelyDeptId(id)) out.push(id);
    }
  }
}

function isLikelyDeptId(id) {
  const s = clean(id);
  if (!/^\d{4,12}$/.test(s)) return false;
  if (/^20\d{2}/.test(s) && s.length <= 8) return false;
  return true;
}

function buildCrmCaseCloseDetailUrl(parDeptId, beginTimeStr = '') {
  const url = new URL('https://crm.jd.com/monitor/monitorCaseInfo/monitorDetail');
  url.searchParams.set('flag', 'all');
  url.searchParams.set('funName', 'caseCloseCount');
  url.searchParams.set('parDeptId', String(parDeptId));
  url.searchParams.set('beginTimeStr', beginTimeStr || getCrmDateRangeInfo(CRM_DATE_RANGE_TODAY).beginTimeStr);
  return url.href;
}

function initCrmLocalExporter() {
  const install = () => {
    const original = document.getElementById('exportMonitorCommonDetail');
    const existing = document.getElementById('jdbeanLocalCrmExport');
    if (existing) {
      if (original) original.remove();
      return;
    }

    const btn = document.createElement('a');
    btn.id = 'jdbeanLocalCrmExport';
    btn.className = original ? original.className : 'btn btn-x';
    btn.href = 'javascript:void(0);';
    btn.style.marginRight = '8px';
    btn.innerHTML = '<s><b><span>导出到本地</span></b></s>';
    btn.addEventListener('click', () => exportCrmMonitorTableToLocal(btn).catch(err => {
      console.error(err);
      alert('导出失败：' + (err.message || err));
    }));

    const status = document.createElement('span');
    status.id = 'jdbeanLocalCrmExportStatus';
    status.style.cssText = 'margin-left:8px;color:#666;font-size:12px;vertical-align:middle;';

    if (original && original.parentNode) {
      original.parentNode.insertBefore(btn, original);
      original.parentNode.insertBefore(status, original.nextSibling);
      original.remove();
    } else {
      const target = document.getElementById('monitorDetail') || document.body;
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin:4px 0 4px 4px;';
      wrap.appendChild(btn);
      wrap.appendChild(status);
      target.parentNode ? target.parentNode.insertBefore(wrap, target.nextSibling) : document.body.appendChild(wrap);
    }
  };

  install();
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      install();
    }, 250);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function exportCrmMonitorTableToLocal(btn) {
  const status = document.getElementById('jdbeanLocalCrmExportStatus');
  const setStatus = (msg) => { if (status) status.textContent = msg; };
  const oldHtml = btn.innerHTML;
  btn.style.pointerEvents = 'none';
  btn.style.opacity = '.65';
  btn.innerHTML = '<s><b><span>正在导出...</span></b></s>';

  try {
    setStatus('正在识别 CRM 数据接口...');
    const data = await fetchCrmRowsFromDetailUrl(location.href, (page, pages, total) => {
      setStatus(`正在读取第 ${page}/${pages} 页，共 ${total || '未知'} 条...`);
    });
    if (!data.rows.length) throw new Error('当前页面没有可导出的数据');
    const rows = data.rows.map(row => data.headers.map(h => row[h] ?? ''));
    downloadCrmRowsAsExcel(data.headers, rows);
    setStatus(`已导出 ${data.rows.length} 条。`);
  } catch (err) {
    const fallbackTable = findCrmDataTable(document);
    const fallback = fallbackTable ? parseCrmMonitorTable(fallbackTable) : { headers: [], rows: [] };
    if (fallback.rows.length) {
      downloadCrmRowsAsExcel(fallback.headers, fallback.rows);
      setStatus(`完整分页读取失败，已导出当前页 ${fallback.rows.length} 条。`);
    } else {
      setStatus('导出失败。');
      throw err;
    }
  } finally {
    btn.innerHTML = oldHtml;
    btn.style.pointerEvents = '';
    btn.style.opacity = '';
  }
}

function getCrmTotalCountFromDoc(doc) {
  const pageText = Array.from(doc.querySelectorAll('.page, .buttonLabel'))
    .map(el => el.textContent || '')
    .join(' ');
  const text = (pageText || doc.body?.textContent || '').replace(/\s+/g, ' ');
  const patterns = [/共\s*(\d+)\s*条?/, /共\s*(\d+)/, /total\s*[:：=]\s*(\d+)/i];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return 0;
}

function getCurrentCrmPageSizeFromDoc(doc) {
  const input = doc.querySelector('#current_size');
  const n = Number(input?.value || 0);
  if (n > 0) return n;
  const selected = doc.querySelector('.page select option[selected], .page select option:checked');
  const selectedNum = Number(selected?.value || 0);
  return selectedNum > 0 ? selectedNum : 0;
}

function getPreferredCrmPageSizeFromDoc(doc) {
  const nums = Array.from(doc.querySelectorAll('.page select option, select option'))
    .map(opt => Number(opt.value || opt.textContent || 0))
    .filter(n => Number.isFinite(n) && n > 0);
  const max = nums.length ? Math.max(...nums) : 100;
  return Math.min(Math.max(max, 10), 100);
}

function findCrmDataTable(doc) {
  const tables = Array.from(doc.querySelectorAll('table'));
  let best = null;
  let bestScore = 0;
  for (const table of tables) {
    const headers = getCrmTableHeaders(table).map(h => normalizeText(h));
    if (!headers.length) continue;
    let score = 0;
    if ((table.id || '').toLowerCase() === 'monitorlist') score += 20;
    const joined = headers.join('|');
    if (joined.includes('事件号')) score += 10;
    if (joined.includes('客户账户') || joined.includes('客户账号') || joined.includes('账户名')) score += 8;
    if (joined.includes('追踪人') || joined.includes('跟踪人')) score += 8;
    if (joined.includes('创建人')) score += 6;
    if (headers.length >= 6) score += 4;
    const dataRows = Array.from(table.querySelectorAll('tbody tr')).filter(tr => clean(tr.textContent));
    if (dataRows.length) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = table;
    }
  }
  return bestScore >= 10 ? best : (doc.querySelector('#monitorlist') || best);
}

function getCrmTableHeaders(table) {
  let cells = Array.from(table.querySelectorAll('thead th'));
  if (!cells.length) {
    const firstRow = table.querySelector('tr');
    cells = firstRow ? Array.from(firstRow.querySelectorAll('th,td')) : [];
  }
  return cells.map(th => normalizeText(th.textContent)).filter(Boolean);
}

function hasCrmRequiredHeader(headers) {
  const normalized = (headers || []).map(h => normalizeText(h)).join('|');
  return normalized.includes('事件号') || normalized.includes('客户账户') || normalized.includes('追踪人') || normalized.includes('创建人');
}

function dedupeCrmRows(parsed) {
  const headers = parsed.headers || [];
  const eventCol = detectColumn(headers, ['事件号', '事件编号', '事件ID', 'caseId', 'CASEID', 'case id', '工单号', '服务单号', '投诉单号', '问题单号', '单号']);
  if (!eventCol) return parsed;
  const seen = new Set();
  const rows = [];
  for (const row of parsed.rows || []) {
    const key = clean(row[eventCol]);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    rows.push(row);
  }
  return { headers, rows };
}

async function fetchCrmMonitorPage(params, pageNumber, pageSize, baseOrigin = location.origin) {
  const url = new URL('/monitor/monitorCaseInfo/monitorCommon', baseOrigin);
  url.searchParams.set('pageNumber', String(pageNumber));
  url.searchParams.set('pageSize', String(pageSize));
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) body.append(key, value == null ? '' : String(value));
  body.set('pageNumber', String(pageNumber));
  body.set('pageSize', String(pageSize));
  return requestText(url.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html, */*; q=0.01' },
    body: body.toString(),
    errorPrefix: '读取分页失败'
  });
}

function parseCrmMonitorTable(table) {
  let headerCells = Array.from(table.querySelectorAll('thead th'));
  let bodyRows = Array.from(table.querySelectorAll('tbody tr'));

  if (!headerCells.length) {
    const allRows = Array.from(table.querySelectorAll('tr'));
    const headerRow = allRows.find(tr => Array.from(tr.children).some(cell => clean(cell.textContent)));
    headerCells = headerRow ? Array.from(headerRow.querySelectorAll('th,td')) : [];
    bodyRows = headerRow ? allRows.slice(allRows.indexOf(headerRow) + 1) : allRows;
  }

  const rawHeaders = headerCells.map(th => normalizeText(th.textContent));
  const keepIndexes = rawHeaders
    .map((h, i) => ({ h, i }))
    .filter(x => x.h && !headerCells[x.i].querySelector('input[type="checkbox"]'));
  const headers = keepIndexes.map(x => x.h);
  const rows = bodyRows.map(tr => {
    const cells = Array.from(tr.children);
    return keepIndexes.map(x => clean(cells[x.i]?.textContent || ''));
  }).filter(row => row.some(Boolean));
  return { headers, rows };
}

function buildUniqueHeaders(row) {
  const used = new Map();
  return (row || []).map((h, i) => {
    const base = clean(h) || `列${i + 1}`;
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function downloadCrmRowsAsExcel(headers, rows) {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const tableHtml = [
    '<table border="1">',
    '<thead><tr>' + headers.map(h => '<th style="mso-number-format:\'@\';">' + esc(h) + '</th>').join('') + '</tr></thead>',
    '<tbody>' + rows.map(row => '<tr>' + row.map(cell => '<td style="mso-number-format:\'@\';">' + esc(cell) + '</td>').join('') + '</tr>').join('') + '</tbody>',
    '</table>'
  ].join('');
  const html = '\uFEFF<html><head><meta charset="utf-8"></head><body>' + tableHtml + '</body></html>';
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'CRM系统数据导出_' + formatDateForCrmFile(new Date()) + '.xls';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatDateForCrmFile(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
