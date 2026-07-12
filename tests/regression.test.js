'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadScript(relativePath, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
  return context;
}

test('bean date parser rejects normalized impossible dates', () => {
  const context = loadScript('src/bean/query.js', {
    clean: value => String(value ?? '').trim()
  });

  assert.equal(context.parseBeanCreateTime('2026-02-30 12:00:00'), null);
  assert.equal(context.parseBeanCreateTime('2025-02-29 12:00:00'), null);
  assert.equal(context.parseBeanCreateTime('2024-02-29 12:00:00').getDate(), 29);
});

test('kfuad only stops pagination when the entire page is too old', () => {
  const context = loadScript('src/bean/query-kfuad.js', {
    clean: value => String(value ?? '').trim(),
    matchesBeanKeyword: (text, keyword) => String(text).includes(keyword),
    formatDateTimeSeconds: date => date.toISOString()
  });
  const begin = 2000;
  const end = 4000;

  const mixed = context.extractKfuadMatchesFromPayload({ content: [
    { createDate: 1500, userVisibleInfo: 'old' },
    { createDate: 3000, userVisibleInfo: 'target' }
  ] }, 'target', begin, end);
  assert.equal(mixed.earlyStop, false);
  assert.equal(mixed.matches.length, 1);

  const old = context.extractKfuadMatchesFromPayload({ content: [
    { createDate: 1000 },
    { createDate: 1500 }
  ] }, 'target', begin, end);
  assert.equal(old.earlyStop, true);
});

test('background proxy validates credentials and disables redirects', async () => {
  let listener;
  let fetchOptions;
  const context = loadScript('src/background/fetch-proxy.js', {
    AbortController,
    TextEncoder,
    URL,
    clearTimeout,
    setTimeout,
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) { listener = fn; }
        }
      }
    },
    fetch: async (_url, options) => {
      fetchOptions = options;
      return { ok: true, status: 200, statusText: 'OK', url: _url, text: async () => 'ok' };
    }
  });

  assert.throws(
    () => context.validateTargetUrl(new URL('https://user:pass@crm.jd.com/monitor/test'), 'GET'),
    /认证信息/
  );

  const response = await new Promise(resolve => {
    const keepChannelOpen = listener(
      { type: 'JD_BEAN_TOOL_FETCH_TEXT', url: 'https://crm.jd.com/monitor/test', options: { method: 'GET' } },
      { url: 'http://newadmin.jpos.jd.com/tool/beanList' },
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });
  assert.equal(response.ok, true);
  assert.equal(fetchOptions.redirect, 'error');
});
