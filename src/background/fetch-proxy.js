'use strict';

const MAX_FETCH_BODY_BYTES = 1024 * 1024;
const ALLOWED_FETCH_METHODS = new Set(['GET', 'POST']);
const ALLOWED_REQUEST_HEADERS = new Map([
  ['accept', 'Accept'],
  ['content-type', 'Content-Type'],
  ['x-requested-with', 'X-Requested-With']
]);

const ALLOWED_SENDER_RULES = [
  { origin: 'http://newadmin.jpos.jd.com', pathPrefixes: ['/tool/beanList'] },
  { origin: 'https://crm.jd.com', pathPrefixes: ['/monitor/monitorCaseInfo/monitorDetail'] }
];

const ALLOWED_TARGET_RULES = [
  { origin: 'https://crm.jd.com', pathPrefixes: ['/monitor/'] },
  { origin: 'http://newadmin.jpos.jd.com', pathPrefixes: ['/tool/beanList'] },
  { origin: 'https://kfuad.jd.com', pathPrefixes: ['/platformApi/api/jingdou/detailBeans'] },
  { origin: 'https://storage.360buyimg.com', pathPrefixes: ['/'], methods: new Set(['GET']), forceCredentials: 'omit' }
];

function normalizeCredentialsMode(value, fallback) {
  return ['include', 'omit', 'same-origin'].includes(value) ? value : fallback;
}

function inferCredentialsMode(url, rule) {
  if (rule && rule.forceCredentials) return rule.forceCredentials;
  if (url.hostname === 'storage.360buyimg.com') return 'omit';
  return 'include';
}

function resolveCredentialsMode(value, url, rule) {
  if (rule && rule.forceCredentials) return rule.forceCredentials;
  return normalizeCredentialsMode(value, inferCredentialsMode(url, rule));
}

function normalizeMethod(value) {
  const method = String(value || 'GET').toUpperCase();
  if (!ALLOWED_FETCH_METHODS.has(method)) throw new Error(`不允许的请求方法：${method}`);
  return method;
}

function normalizeHeaders(input) {
  const headers = { Accept: '*/*' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return headers;

  for (const [rawName, rawValue] of Object.entries(input)) {
    const key = String(rawName || '').toLowerCase();
    const name = ALLOWED_REQUEST_HEADERS.get(key);
    if (!name) throw new Error(`不允许的请求头：${rawName}`);
    if (rawValue == null) continue;
    const value = String(rawValue);
    if (/[\r\n]/.test(value)) throw new Error(`请求头包含非法换行：${rawName}`);
    if (value.length > 2048) throw new Error(`请求头过长：${rawName}`);
    headers[name] = value;
  }

  return headers;
}

function normalizeBody(value, method) {
  if (value == null || value === '') return undefined;
  if (method === 'GET') throw new Error('GET 请求不允许携带 body');
  if (typeof value !== 'string') throw new Error('请求 body 必须是字符串');

  const size = typeof TextEncoder === 'function'
    ? new TextEncoder().encode(value).length
    : value.length;
  if (size > MAX_FETCH_BODY_BYTES) throw new Error('请求 body 超过 1MB 限制');
  return value;
}

function matchesPathPrefix(pathname, prefix) {
  if (prefix === '/') return true;
  if (pathname === prefix) return true;
  return prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname.startsWith(`${prefix}/`);
}

function matchesRule(url, rule) {
  return url.origin === rule.origin
    && rule.pathPrefixes.some(prefix => matchesPathPrefix(url.pathname, prefix));
}

function findAllowedTargetRule(url, method) {
  const rule = ALLOWED_TARGET_RULES.find(item => matchesRule(url, item));
  if (!rule) return null;
  if (rule.methods && !rule.methods.has(method)) return null;
  return rule;
}

function isAllowedSender(sender) {
  const rawUrl = sender && (sender.url || sender.tab?.url || '');
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return ALLOWED_SENDER_RULES.some(rule => matchesRule(url, rule));
  } catch (_) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'JD_BEAN_TOOL_FETCH_TEXT') return false;

  (async () => {
    if (!isAllowedSender(sender)) {
      throw new Error('不允许的消息来源');
    }

    const target = new URL(message.url);
    const opts = message.options || {};
    const method = normalizeMethod(opts.method);
    const rule = findAllowedTargetRule(target, method);
    if (!rule) {
      throw new Error(`不允许访问的地址：${target.origin}${target.pathname}`);
    }

    const body = normalizeBody(opts.body, method);
    const credentials = resolveCredentialsMode(opts.credentials, target, rule);
    const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || 30000, 1000), 120000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(target.href, {
        method,
        headers: normalizeHeaders(opts.headers),
        body,
        credentials,
        redirect: 'follow',
        signal: controller.signal
      });
      const text = await res.text();
      sendResponse({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: res.url,
        text
      });
    } finally {
      clearTimeout(timer);
    }
  })().catch(err => {
    sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
  });

  return true;
});
