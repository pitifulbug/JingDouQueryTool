'use strict';

function bindPanelEvents() {
  els.startBtn.addEventListener('click', () => runBatchDispatch().catch(err => {
    console.error(err);
    handleRuntimeInvalidated(err);
    log(`执行失败：${toFriendlyError(err)}`);
    state.running = false;
    updateButtons();
  }));

  els.stopBtn.addEventListener('click', () => {
    state.stopped = true;
    log('已请求停止，当前账号查完后停止。');
  });

  els.exportBtn.addEventListener('click', () => exportHitsCsv());

  els.loadCrmBtn.addEventListener('click', () => loadCrmSourceData().catch(err => {
    console.error(err);
    handleRuntimeInvalidated(err);
    const friendly = toFriendlyError(err);
    alert(`读取CRM数据失败：${friendly}`);
    log(`读取CRM数据失败：${friendly}`);
    els.loadCrmBtn.disabled = false;
  }));
  if (els.crmDateRange) els.crmDateRange.addEventListener('change', () => resetCrmLoadedDataForRangeChange());
  els.crmPersonSelect.addEventListener('change', () => applyCrmPersonSelection());
  if (els.requestSource) els.requestSource.addEventListener('change', () => {
    state.requestSource = els.requestSource.value || DEFAULT_REQUEST_SOURCE;
    state.beanQueryCache = new Map();
    log(`已切换请求来源为 ${state.requestSource === REQUEST_SOURCE_KFUAD ? 'kfuad' : 'jpos'}。`);
  });

  els.clearBtn.addEventListener('click', () => {
    if (state.running || state.loadingCrm) return;
    state.rows = [];
    state.headers = [];
    state.results = [];
    state.crmData = null;
    state.crmDateRangeMode = CRM_DATE_RANGE_TODAY;
    state.sourceContext = null;
    state.beanQueryCache = new Map();
    els.accountCol.innerHTML = '';
    els.eventCol.innerHTML = '';
    if (els.crmDateRange) els.crmDateRange.value = CRM_DATE_RANGE_TODAY;
    state.requestSource = DEFAULT_REQUEST_SOURCE;
    if (els.requestSource) els.requestSource.value = DEFAULT_REQUEST_SOURCE;
    refreshCrmDateRangeOptions();
    const info = getSelectedCrmDateRangeInfo();
    els.crmPersonSelect.innerHTML = '<option value="">请先读取数据</option>';
    els.crmPersonSelect.disabled = true;
    state.autoDetected = null;
    renderSourceSummary();
    els.detectStatus.textContent = `数据日期：${info.optionLabel}`;
    applyDefaultTimeRange();
    clearResultsView();
    els.log.textContent = `数据日期：${info.optionLabel}`;
    els.startBtn.disabled = true;
    els.exportBtn.disabled = true;
    resetStats();
  });

  els.toggleBtn.addEventListener('click', () => togglePanelBody());
  els.minimizeBtn.addEventListener('click', e => {
    e.stopPropagation();
    togglePanelBody();
  });
  els.zoomBtn.addEventListener('click', e => {
    e.stopPropagation();
    togglePanelMaximized();
  });
  els.closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    hidePanelToRestorePill();
  });
  els.restoreBtn.addEventListener('click', () => restorePanelFromPill());

  bindFilterEvents();

  applyDefaultTimeRange();
  initDataSourceControls();
  renderSourceSummary();
  makeDraggable();
}

function bindFilterEvents() {
  if (!els.panel || !els.filterPopover) return;

  els.panel.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('.th-filter');
    if (!btn || !root.contains(btn)) return;
    e.stopPropagation();
    const colKey = btn.dataset.colKey;
    if (state.filterPopoverCol === colKey && !els.filterPopover.classList.contains('hidden')) {
      closeFilterPopover();
    } else {
      openFilterPopover(colKey, btn);
    }
  });

  els.filterPopover.addEventListener('click', e => e.stopPropagation());

  els.filterPopoverSearch.addEventListener('input', e => {
    renderFilterPopoverList(e.target.value);
  });

  els.filterPopoverList.addEventListener('change', e => {
    const input = e.target;
    if (!input || input.type !== 'checkbox') return;
    if (input.dataset.all === '1') {
      const values = getCurrentFilteredEntryValues();
      if (input.checked) values.forEach(v => state.filterPopoverSelected.add(v));
      else values.forEach(v => state.filterPopoverSelected.delete(v));
      renderFilterPopoverList(els.filterPopoverSearch.value);
      return;
    }
    const idx = Number(input.dataset.idx);
    const values = getCurrentFilteredEntryValues();
    const value = values[idx];
    if (value == null) return;
    if (input.checked) state.filterPopoverSelected.add(value);
    else state.filterPopoverSelected.delete(value);
    const masterCheckbox = els.filterPopoverList.querySelector('input[data-all="1"]');
    if (masterCheckbox) {
      masterCheckbox.checked = values.length > 0 && values.every(v => state.filterPopoverSelected.has(v));
    }
  });

  els.filterPopoverApply.addEventListener('click', () => applyFilterPopoverSelection());
  els.filterPopoverCancel.addEventListener('click', () => closeFilterPopover());
  els.filterPopoverClear.addEventListener('click', () => clearFilterForCurrentColumn());

  root.addEventListener('click', e => {
    if (els.filterPopover.classList.contains('hidden')) return;
    if (els.filterPopover.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.th-filter')) return;
    closeFilterPopover();
  });

  document.addEventListener('click', () => {
    if (!els.filterPopover.classList.contains('hidden')) closeFilterPopover();
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !els.filterPopover.classList.contains('hidden')) closeFilterPopover();
  });

  window.addEventListener('resize', () => {
    if (!els.filterPopover.classList.contains('hidden')) closeFilterPopover();
  });
  window.addEventListener('scroll', () => {
    if (!els.filterPopover.classList.contains('hidden')) closeFilterPopover();
  }, true);
}

function setPanelBodyCollapsed(hidden) {
  els.body.classList.toggle('hidden', hidden);
  els.toggleBtn.textContent = hidden ? '+' : '−';
  els.minimizeBtn.title = hidden ? '展开' : '收起';
  els.minimizeBtn.setAttribute('aria-label', hidden ? '展开面板内容' : '收起面板内容');
}

function togglePanelBody() {
  setPanelBodyCollapsed(!els.body.classList.contains('hidden'));
}

function togglePanelMaximized() {
  const maximized = els.panel.classList.toggle('maximized');
  els.zoomBtn.title = maximized ? '还原' : '最大化';
  els.zoomBtn.setAttribute('aria-label', maximized ? '还原面板' : '最大化面板');
}

function hidePanelToRestorePill() {
  els.panel.classList.add('hidden');
  els.restoreBtn.classList.remove('hidden');
}

function restorePanelFromPill() {
  els.panel.classList.remove('hidden');
  els.restoreBtn.classList.add('hidden');
}
