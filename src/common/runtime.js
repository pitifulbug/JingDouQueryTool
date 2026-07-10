'use strict';

const EXTENSION_CONTEXT_INVALIDATED_TEXT = '插件上下文已失效。通常是扩展被重新加载、更新或停用后，当前页面仍在运行旧脚本。请刷新当前京豆页面后重新查询。';

function isExtensionContextInvalidatedText(value) {
  return /extension context invalidated|context invalidated|extension has been reloaded|receiving end does not exist|message port closed/i.test(String(value || ''));
}

function createExtensionContextInvalidatedError(detail = '') {
  const err = new Error(detail ? `${EXTENSION_CONTEXT_INVALIDATED_TEXT} 原始错误：${detail}` : EXTENSION_CONTEXT_INVALIDATED_TEXT);
  err.code = 'EXTENSION_CONTEXT_INVALIDATED';
  return err;
}

function isExtensionContextInvalidatedError(err) {
  return Boolean(err && (err.code === 'EXTENSION_CONTEXT_INVALIDATED' || isExtensionContextInvalidatedText(err.message || err)));
}

function isChromeRuntimeAvailable() {
  try {
    return typeof chrome !== 'undefined'
      && Boolean(chrome.runtime)
      && Boolean(chrome.runtime.id)
      && typeof chrome.runtime.sendMessage === 'function';
  } catch (_) {
    return false;
  }
}

function readRuntimeLastErrorMessage() {
  try {
    return chrome.runtime.lastError?.message || '';
  } catch (err) {
    return err && err.message ? err.message : String(err);
  }
}

function sendRuntimeMessageSafe(message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!isChromeRuntimeAvailable()) {
      reject(createExtensionContextInvalidatedError());
      return;
    }

    let settled = false;
    const safeReject = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      safeReject(new Error('插件后台通信超时，请刷新页面后重试。'));
    }, Math.min(Math.max(Number(timeoutMs) || 30000, 1000), 120000) + 1000);

    try {
      chrome.runtime.sendMessage(message, resp => {
        const runtimeErr = readRuntimeLastErrorMessage();
        if (runtimeErr) {
          safeReject(isExtensionContextInvalidatedText(runtimeErr)
            ? createExtensionContextInvalidatedError(runtimeErr)
            : new Error(runtimeErr || '插件后台通信失败'));
          return;
        }
        safeResolve(resp);
      });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      safeReject(isExtensionContextInvalidatedText(message) ? createExtensionContextInvalidatedError(message) : err);
    }
  });
}

function handleRuntimeInvalidated(err) {
  if (!isExtensionContextInvalidatedError(err)) return false;
  try {
    if (state) {
      state.running = false;
      state.stopped = true;
    }
    if (typeof flushResultsNow === 'function') flushResultsNow();
    if (typeof updateButtons === 'function') updateButtons();
    if (typeof log === 'function') log(EXTENSION_CONTEXT_INVALIDATED_TEXT);
  } catch (_) {}
  return true;
}

function installRuntimeErrorGuard() {
  if (window.__jdBeanRuntimeErrorGuardInstalled) return;
  window.__jdBeanRuntimeErrorGuardInstalled = true;

  window.addEventListener('error', event => {
    const err = event.error || event.message;
    if (handleRuntimeInvalidated(err)) event.preventDefault();
  });

  window.addEventListener('unhandledrejection', event => {
    if (handleRuntimeInvalidated(event.reason)) event.preventDefault();
  });
}
