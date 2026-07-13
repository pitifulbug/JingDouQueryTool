'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadScript } = require('./helpers/load-script');

let listener;
let fetchImpl = async url => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  url,
  text: async () => 'ok'
});

const proxy = loadScript('src/background/fetch-proxy.js', [
  'normalizeCredentialsMode',
  'inferCredentialsMode',
  'resolveCredentialsMode',
  'normalizeMethod',
  'normalizeHeaders',
  'normalizeBody',
  'matchesPathPrefix',
  'matchesRule',
  'findAllowedTargetRule',
  'validateTargetUrl',
  'isAllowedSender'
], {
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
  fetch(...args) { return fetchImpl(...args); }
});

function send(message, sender = { url: 'http://newadmin.jpos.jd.com/tool/beanList' }) {
  return new Promise(resolve => {
    assert.equal(listener(message, sender, resolve), true);
  });
}

test('proxy normalizes credentials, methods, headers, and request bodies', () => {
  const storage = new URL('https://storage.360buyimg.com/app.js');
  const storageRule = proxy.findAllowedTargetRule(storage, 'GET');

  assert.equal(proxy.normalizeCredentialsMode('same-origin', 'include'), 'same-origin');
  assert.equal(proxy.normalizeCredentialsMode('invalid', 'include'), 'include');
  assert.equal(proxy.inferCredentialsMode(storage, storageRule), 'omit');
  assert.equal(proxy.resolveCredentialsMode('include', storage, storageRule), 'omit');
  assert.equal(proxy.normalizeMethod(), 'GET');
  assert.equal(proxy.normalizeMethod('post'), 'POST');
  assert.throws(() => proxy.normalizeMethod('DELETE'), /不允许的请求方法/);

  assert.deepEqual(proxy.normalizeHeaders(null), { Accept: '*/*' });
  assert.deepEqual(proxy.normalizeHeaders([]), { Accept: '*/*' });
  assert.deepEqual(proxy.normalizeHeaders({
    accept: 'application/json',
    'content-type': 'application/json',
    'x-requested-with': null
  }), {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  });
  assert.throws(() => proxy.normalizeHeaders({ Authorization: 'secret' }), /不允许的请求头/);
  assert.throws(() => proxy.normalizeHeaders({ Accept: 'ok\r\nbad' }), /非法换行/);
  assert.throws(() => proxy.normalizeHeaders({ Accept: 'x'.repeat(2049) }), /请求头过长/);

  assert.equal(proxy.normalizeBody(null, 'POST'), undefined);
  assert.equal(proxy.normalizeBody('', 'POST'), undefined);
  assert.equal(proxy.normalizeBody('value', 'POST'), 'value');
  assert.throws(() => proxy.normalizeBody('value', 'GET'), /GET 请求不允许/);
  assert.throws(() => proxy.normalizeBody({ value: 1 }, 'POST'), /必须是字符串/);
  assert.throws(() => proxy.normalizeBody('x'.repeat(1024 * 1024 + 1), 'POST'), /超过 1MB/);
});

test('proxy allowlists exact origins, path boundaries, methods, and senders', () => {
  assert.equal(proxy.matchesPathPrefix('/monitor', '/monitor'), true);
  assert.equal(proxy.matchesPathPrefix('/monitor/a', '/monitor'), true);
  assert.equal(proxy.matchesPathPrefix('/monitoring', '/monitor'), false);
  assert.equal(proxy.matchesPathPrefix('/anything', '/'), true);
  assert.equal(proxy.matchesPathPrefix('/monitor/a', '/monitor/'), true);

  const crm = new URL('https://crm.jd.com/monitor/businessMonitor');
  assert.ok(proxy.findAllowedTargetRule(crm, 'GET'));
  assert.equal(proxy.findAllowedTargetRule(new URL('https://storage.360buyimg.com/a'), 'POST'), null);
  assert.throws(() => proxy.validateTargetUrl(new URL('https://evil.example/monitor/a'), 'GET'), /不允许访问/);
  assert.throws(() => proxy.validateTargetUrl(new URL('https://user:pass@crm.jd.com/monitor/a'), 'GET'), /认证信息/);

  assert.equal(proxy.isAllowedSender({ url: 'http://newadmin.jpos.jd.com/tool/beanList?x=1' }), true);
  assert.equal(proxy.isAllowedSender({ tab: { url: 'https://crm.jd.com/monitor/monitorCaseInfo/monitorDetail?id=1' } }), true);
  assert.equal(proxy.isAllowedSender({ url: 'http://newadmin.jpos.jd.com/tool/beanListing' }), false);
  assert.equal(proxy.isAllowedSender({ url: 'not a url' }), false);
  assert.equal(proxy.isAllowedSender(null), false);
});

test('proxy listener ignores unrelated messages and rejects invalid requests', async () => {
  assert.equal(listener({ type: 'OTHER' }, {}, () => {}), false);

  const invalidSender = await send(
    { type: 'JD_BEAN_TOOL_FETCH_TEXT', url: 'https://crm.jd.com/monitor/a' },
    { url: 'https://evil.example/' }
  );
  assert.equal(invalidSender.ok, false);
  assert.match(invalidSender.error, /不允许的消息来源/);

  const invalidTarget = await send({
    type: 'JD_BEAN_TOOL_FETCH_TEXT',
    url: 'https://evil.example/a'
  });
  assert.equal(invalidTarget.ok, false);
  assert.match(invalidTarget.error, /不允许访问/);
});

test('proxy listener forwards validated responses and enforces final URL rules', async () => {
  let received;
  fetchImpl = async (url, options) => {
    received = { url, options };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      url,
      text: async () => 'payload'
    };
  };

  const response = await send({
    type: 'JD_BEAN_TOOL_FETCH_TEXT',
    url: 'https://storage.360buyimg.com/tool.js',
    options: { method: 'GET', credentials: 'include', timeoutMs: 1 }
  });
  assert.equal(response.ok, true);
  assert.equal(response.text, 'payload');
  assert.equal(received.options.credentials, 'omit');
  assert.equal(received.options.redirect, 'follow');
  assert.equal(received.options.body, undefined);

  fetchImpl = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://login.jd.com/login',
    text: async () => 'login'
  });
  const redirected = await send({
    type: 'JD_BEAN_TOOL_FETCH_TEXT',
    url: 'https://crm.jd.com/monitor/a'
  });
  assert.equal(redirected.ok, false);
  assert.match(redirected.error, /不允许访问/);

  fetchImpl = async () => { throw 'network down'; };
  const failed = await send({
    type: 'JD_BEAN_TOOL_FETCH_TEXT',
    url: 'https://crm.jd.com/monitor/a'
  });
  assert.deepEqual(failed, { ok: false, error: 'network down' });
});
