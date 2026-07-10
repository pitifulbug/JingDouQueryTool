'use strict';

function exportHitsCsv() {
  const allHits = state.results.filter(r => r.status === '命中');
  const hits = allHits.filter(r => rowPassesFilters(r));
  if (!allHits.length) {
    alert('暂无命中数据可导出。');
    return;
  }
  if (!hits.length) {
    alert('当前筛选下没有可导出的命中数据。');
    return;
  }
  if (hits.length < allHits.length) {
    log(`按当前筛选导出 ${hits.length}/${allHits.length} 条命中。`);
  }
  const headers = ['事件号', '追踪人', 'ERP', '客户账户', '京豆创建时间', '京豆数量', '业务编号', '业务编号1', '活动ID', '活动名称', '详细说明', '溯源链接'];
  const rows = hits.map(r => [
    r.eventNo || '',
    r.trackerName || '',
    r.trackerErp || '',
    r.account || '',
    r.beanCreateTime || '',
    r.beanAmount || '',
    r.businessNo || '',
    r.businessNo1 || '',
    r.activityId || '',
    r.activityName || '',
    r.detail || '',
    r.sourceLink || ''
  ]);
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `京豆满意度调研命中结果_${formatDateForFile(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[\t\r]/.test(s) || /^\s*[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function formatDateForFile(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
