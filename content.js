
(() => {
  'use strict';

  if (window.__jdBeanBatchToolLoaded) return;
  window.__jdBeanBatchToolLoaded = true;
  installRuntimeErrorGuard();

  if (isCrmMonitorPage()) {
    initCrmLocalExporter();
    return;
  }

  initJdBeanTool();
})();
