'use strict';

function unique(arr) {
  return Array.from(new Set((arr || []).map(x => clean(x)).filter(Boolean)));
}

function decodeHtmlAttr(v) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(v || '');
  return textarea.value;
}

function normalizeText(v) {
  return String(v ?? '').replace(/[\s:_\-—（）()【】\[\]{}\.。]+/g, '').trim();
}

function clean(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function matchesBeanKeyword(text, keyword) {
  const s = String(text ?? '');
  if (!s.includes(keyword)) return false;
  const excluded = typeof EXCLUDED_KEYWORDS !== 'undefined' ? EXCLUDED_KEYWORDS : [];
  for (const ex of excluded) {
    if (ex && s.includes(ex)) return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function addDays(date, days) {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function endOfToday() {
  const today = startOfToday();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
}

function buildDateRangeFromCrmInfo(info) {
  const begin = info?.begin instanceof Date ? info.begin : startOfToday();
  const end = endOfToday();
  return { start: begin, end };
}

function createAsyncLimiter(limit = 4) {
  const max = Math.max(1, Number(limit) || 1);
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    const item = queue.shift();
    active++;
    Promise.resolve()
      .then(item.fn)
      .then(item.resolve, item.reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return fn => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

function isRetriableNetworkError(err) {
  const msg = String(err && err.message ? err.message : err || '');
  if (isExtensionContextInvalidatedText(msg)) return false;
  if (/HTTP\s*(?:408|429|5\d{2})/.test(msg)) return true;
  if (/abort|timed?\s*out|timeout|network|failed to fetch|ERR_|ECONNRESET|socket hang up|ETIMEDOUT|EAI_AGAIN/i.test(msg)) return true;
  return false;
}

async function runWithRetry(fn, { retries = 2, baseDelayMs = 300, isRetriable = isRetriableNetworkError } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (state && state.stopped) throw lastErr || new Error('已停止');
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetriable(err)) throw err;
      const delay = baseDelayMs * Math.pow(3, attempt) + Math.floor(Math.random() * 150);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function runConcurrentTasks(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const max = Math.max(1, Number(limit) || 1);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(max, list.length) }, async () => {
    while (!state?.stopped) {
      const index = cursor++;
      if (index >= list.length) break;
      await worker(list[index], index);
    }
  });
  await Promise.all(workers);
}

function formatDateOnly(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTimeSeconds(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getCrmDateRangeInfo(mode = CRM_DATE_RANGE_TODAY, now = new Date()) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const normalizedMode = mode === CRM_DATE_RANGE_YESTERDAY_TODAY ? CRM_DATE_RANGE_YESTERDAY_TODAY : CRM_DATE_RANGE_TODAY;
  const begin = normalizedMode === CRM_DATE_RANGE_YESTERDAY_TODAY ? addDays(todayStart, -1) : todayStart;
  const todayText = formatDateOnly(todayStart);
  const beginText = formatDateOnly(begin);
  const label = normalizedMode === CRM_DATE_RANGE_YESTERDAY_TODAY ? `${beginText} 至 ${todayText}` : todayText;
  return {
    mode: normalizedMode,
    begin,
    today: todayStart,
    beginDateText: beginText,
    todayDateText: todayText,
    beginTimeStr: formatDateTimeSeconds(begin),
    label,
    shortLabel: label,
    optionLabel: `${label} 关闭量`,
    statusDateText: label
  };
}

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function nextAnimationFrame() {
  return new Promise(resolve => {
    const raf = window.requestAnimationFrame || (cb => window.setTimeout(cb, 16));
    raf(() => resolve());
  });
}

async function yieldToBrowser() {
  await nextAnimationFrame();
}
