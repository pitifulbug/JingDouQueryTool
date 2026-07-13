'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadScript } = require('./helpers/load-script');

let nextTimerId = 1;
const timers = new Map();
const listeners = new Map();
const calls = { flush: 0, update: 0, logs: [] };

const runtime = loadScript('src/common/runtime.js', [
  'isExtensionContextInvalidatedText',
  'createExtensionContextInvalidatedError',
  'isExtensionContextInvalidatedError',
  'isChromeRuntimeAvailable',
  'readRuntimeLastErrorMessage',
  'sendRuntimeMessageSafe',
  'handleRuntimeInvalidated',
  'installRuntimeErrorGuard'
], {
  chrome: {},
  state: { running: true, stopped: false },
  flushResultsNow() { calls.flush++; },
  updateButtons() { calls.update++; },
  log(value) { calls.logs.push(value); },
  setTimeout(callback, delay) {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  window: {
    addEventListener(type, listener) { listeners.set(type, listener); }
  }
});

function installChrome(sendMessage) {
  globalThis.chrome = {
    runtime: {
      id: 'extension-id',
      lastError: null,
      sendMessage
    }
  };
}

function takeOnlyTimer() {
  assert.equal(timers.size, 1);
  const [id, timer] = timers.entries().next().value;
  timers.delete(id);
  return timer;
}

test('runtime classifies invalidated extension contexts consistently', () => {
  assert.equal(runtime.isExtensionContextInvalidatedText('Extension context invalidated.'), true);
  assert.equal(runtime.isExtensionContextInvalidatedText('Receiving end does not exist'), true);
  assert.equal(runtime.isExtensionContextInvalidatedText('network failed'), false);

  const error = runtime.createExtensionContextInvalidatedError('original');
  assert.equal(error.code, 'EXTENSION_CONTEXT_INVALIDATED');
  assert.match(error.message, /原始错误：original/);
  assert.equal(runtime.isExtensionContextInvalidatedError(error), true);
  assert.equal(runtime.isExtensionContextInvalidatedError(new Error('ordinary')), false);
});

test('runtime messaging rejects unavailable and invalidated contexts', async () => {
  globalThis.chrome = {};
  assert.equal(runtime.isChromeRuntimeAvailable(), false);
  await assert.rejects(runtime.sendRuntimeMessageSafe({}), error => {
    assert.equal(error.code, 'EXTENSION_CONTEXT_INVALIDATED');
    return true;
  });

  installChrome((_message, callback) => {
    globalThis.chrome.runtime.lastError = { message: 'Extension context invalidated.' };
    callback();
    globalThis.chrome.runtime.lastError = null;
  });
  await assert.rejects(runtime.sendRuntimeMessageSafe({}), error => {
    assert.equal(error.code, 'EXTENSION_CONTEXT_INVALIDATED');
    return true;
  });

  installChrome(() => { throw new Error('Extension has been reloaded'); });
  await assert.rejects(runtime.sendRuntimeMessageSafe({}), error => {
    assert.equal(error.code, 'EXTENSION_CONTEXT_INVALIDATED');
    return true;
  });
});

test('runtime messaging resolves responses and preserves ordinary errors', async () => {
  installChrome((_message, callback) => callback({ ok: true }));
  assert.deepEqual(await runtime.sendRuntimeMessageSafe({ type: 'test' }), { ok: true });
  assert.equal(timers.size, 0);

  installChrome((_message, callback) => {
    globalThis.chrome.runtime.lastError = { message: 'ordinary failure' };
    callback();
    globalThis.chrome.runtime.lastError = null;
  });
  await assert.rejects(runtime.sendRuntimeMessageSafe({}), /ordinary failure/);
  assert.equal(timers.size, 0);
});

test('runtime messaging clamps timeouts and settles once', async () => {
  installChrome(() => {});
  const lower = runtime.sendRuntimeMessageSafe({}, 1);
  const lowerTimer = takeOnlyTimer();
  assert.equal(lowerTimer.delay, 2000);
  lowerTimer.callback();
  await assert.rejects(lower, /通信超时/);

  const upper = runtime.sendRuntimeMessageSafe({}, 999999);
  const upperTimer = takeOnlyTimer();
  assert.equal(upperTimer.delay, 121000);
  upperTimer.callback();
  await assert.rejects(upper, /通信超时/);
});

test('runtime invalidation handler updates state and guard installs once', () => {
  globalThis.state = { running: true, stopped: false };
  calls.flush = 0;
  calls.update = 0;
  calls.logs = [];

  assert.equal(runtime.handleRuntimeInvalidated(new Error('ordinary')), false);
  assert.equal(runtime.handleRuntimeInvalidated(new Error('message port closed')), true);
  assert.deepEqual(globalThis.state, { running: false, stopped: true });
  assert.equal(calls.flush, 1);
  assert.equal(calls.update, 1);
  assert.equal(calls.logs.length, 1);

  runtime.installRuntimeErrorGuard();
  runtime.installRuntimeErrorGuard();
  assert.deepEqual(Array.from(listeners.keys()).sort(), ['error', 'unhandledrejection']);

  let prevented = 0;
  listeners.get('error')({
    error: new Error('Extension context invalidated'),
    preventDefault() { prevented++; }
  });
  listeners.get('unhandledrejection')({
    reason: new Error('ordinary'),
    preventDefault() { prevented++; }
  });
  assert.equal(prevented, 1);
});
