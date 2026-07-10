'use strict';

function initJdBeanTool() {
  if (document.getElementById('jdbean-tool-host')) return;

  state = createInitialState();
  state.beanListForm = findBeanListForm();
  state.appMode = shouldUseStandaloneHomePageMode();

  host = document.createElement('div');
  host.id = 'jdbean-tool-host';
  if (state.appMode) host.className = 'app-mode';
  document.documentElement.appendChild(host);
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = getPanelTemplate();
  installScopedCursorStyle();

  const $ = (id) => root.getElementById(id);
  els = {
  panel: $('panel'), body: $('body'), dragHandle: $('dragHandle'), toggleBtn: $('toggleBtn'),
  runtimeTitle: $('runtimeTitle'), closeBtn: $('closeBtn'), minimizeBtn: $('minimizeBtn'), zoomBtn: $('zoomBtn'), restoreBtn: $('restoreBtn'),
  crmPersonSelect: $('crmPersonSelect'), crmDateRange: $('crmDateRange'), loadCrmBtn: $('loadCrmBtn'), sourceSummary: $('sourceSummary'),
  accountCol: $('accountCol'), eventCol: $('eventCol'),
  detectStatus: $('detectStatus'),
  requestSource: $('requestSource'),
  startTime: $('startTime'), endTime: $('endTime'),
  startBtn: $('startBtn'), stopBtn: $('stopBtn'), exportBtn: $('exportBtn'), clearBtn: $('clearBtn'),
  log: $('log'), resultBody: $('resultBody'), bar: $('bar'),
  sTotal: $('sTotal'), sDone: $('sDone'), sHit: $('sHit'), sNoHit: $('sNoHit'), sError: $('sError'), sSkipped: $('sSkipped'),
  filterPopover: $('filterPopover'), filterPopoverTitle: $('filterPopoverTitle'),
  filterPopoverSearch: $('filterPopoverSearch'), filterPopoverList: $('filterPopoverList'),
  filterPopoverApply: $('filterPopoverApply'), filterPopoverCancel: $('filterPopoverCancel'), filterPopoverClear: $('filterPopoverClear')
};

  if (state.appMode) installStandaloneHomePageMode();
  renderRuntimeTitle();
  bindPanelEvents();
}

function shouldUseStandaloneHomePageMode() {
  return location.hostname === 'newadmin.jpos.jd.com' && location.pathname.indexOf('/tool/beanList') >= 0;
}

function findBeanListForm() {
  return document.querySelector('form#form1') || document.querySelector('form[action*="/tool/beanList"]');
}

function installStandaloneHomePageMode() {
  if (!document.body || document.body.dataset.jdbeanStandaloneHome === '1') return;
  document.body.dataset.jdbeanStandaloneHome = '1';

  const originalForm = state.beanListForm || findBeanListForm();
  const preservedForm = cloneBeanListFormForRequests(originalForm);

  originalPageCache = document.createElement('div');
  originalPageCache.id = 'jdbean-original-page-cache';
  originalPageCache.setAttribute('aria-hidden', 'true');
  originalPageCache.style.cssText = [
    'position:fixed',
    'left:-999999px',
    'top:-999999px',
    'width:1px',
    'height:1px',
    'overflow:hidden',
    'opacity:0',
    'pointer-events:none',
    'visibility:hidden'
  ].join(';');
  if (preservedForm) {
    originalPageCache.appendChild(preservedForm);
    state.beanListForm = preservedForm;
  }

  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  document.body.appendChild(originalPageCache);

  document.documentElement.classList.add('jdbean-standalone-home-html');
  document.body.classList.add('jdbean-standalone-home-body');
  document.documentElement.style.setProperty('width', '100%', 'important');
  document.documentElement.style.setProperty('height', '100%', 'important');
  document.documentElement.style.setProperty('margin', '0', 'important');
  document.documentElement.style.setProperty('overflow', 'hidden', 'important');
  document.body.style.setProperty('width', '100%', 'important');
  document.body.style.setProperty('height', '100%', 'important');
  document.body.style.setProperty('margin', '0', 'important');
  document.body.style.setProperty('overflow', 'hidden', 'important');
  document.body.style.setProperty('background', '#f5f5f7', 'important');

  const style = document.createElement('style');
  style.id = 'jdbean-standalone-home-style';
  style.textContent = `
    html.jdbean-standalone-home-html,
    body.jdbean-standalone-home-body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      overflow: hidden !important;
      background: #f5f5f7 !important;
    }
  `;
  document.head ? document.head.appendChild(style) : document.documentElement.appendChild(style);
}

function cloneBeanListFormForRequests(form) {
  if (!form) return null;
  const clone = form.cloneNode(true);
  clone.id = form.id || 'form1';
  clone.style.display = 'none';
  clone.setAttribute('data-jdbean-preserved-form', '1');

  const originalFields = form.querySelectorAll('input, textarea, select');
  const clonedFields = clone.querySelectorAll('input, textarea, select');
  originalFields.forEach((source, index) => {
    const target = clonedFields[index];
    if (!target) return;
    if (source.tagName === 'SELECT') {
      target.value = source.value;
      Array.from(target.options || []).forEach(option => {
        option.selected = option.value === source.value;
      });
    } else if (source.type === 'checkbox' || source.type === 'radio') {
      target.checked = source.checked;
      if (source.checked) target.setAttribute('checked', 'checked');
      else target.removeAttribute('checked');
    } else {
      target.value = source.value;
      target.setAttribute('value', source.value);
    }
  });
  return clone;
}

function installScopedCursorStyle() {
  const arrowCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M5 3.5L21.5 18.6l-8.2 1.1 4.3 7.3-3.1 1.8-4.4-7.5-5.1 5.1z' fill='white' stroke='black' stroke-width='1.45' stroke-linejoin='round'/%3E%3C/svg%3E") 5 3`;
  const handCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M12.8 28.5c-1.4-1.4-3.8-4.2-5.1-6.4-.7-1.2-.4-2.4.6-2.9.9-.5 1.8-.2 2.6.6l1 1V8.6a1.8 1.8 0 0 1 3.6 0v7.7h.5v-2.5a1.8 1.8 0 0 1 3.6 0v2.5h.5v-1.8a1.8 1.8 0 0 1 3.6 0v2.5h.4a1.8 1.8 0 0 1 3.5.5v4.3c0 3.7-2.9 6.7-6.6 6.7z' fill='white' stroke='black' stroke-width='1.35' stroke-linejoin='round'/%3E%3C/svg%3E") 13 7`;
  if (root && root.host) {
    root.host.style.setProperty('--jdbean-cursor-arrow', arrowCursor);
    root.host.style.setProperty('--jdbean-cursor-hand', handCursor);
  }
}
