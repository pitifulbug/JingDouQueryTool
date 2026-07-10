'use strict';

function getPanelTemplate() {
  return `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; cursor: var(--jdbean-cursor-arrow), default; }
    .panel {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 2147483647;
      width: 980px;
      max-width: calc(100vw - 28px);
      max-height: calc(100vh - 56px);
      overflow: auto;
      background: #fff;
      color: #1d1d1f;
      contain: layout paint style;
      border: 1px solid rgba(255,255,255,.62);
      border-radius: 26px;
      box-shadow: 0 16px 48px rgba(0,0,0,.20), 0 2px 10px rgba(0,0,0,.08);
      padding: 14px;
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
    }
    :host(.app-mode) {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      width: 100vw;
      height: 100vh;
      display: block;
      background: #f5f5f7;
    }
    :host(.app-mode) .panel {
      position: fixed;
      inset: 0;
      top: 0 !important;
      left: 0 !important;
      transform: none !important;
      width: 100vw !important;
      max-width: none !important;
      height: 100vh !important;
      max-height: none !important;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      padding: 18px 22px;
      overflow: auto;
      background: #f5f5f7;
    }
    :host(.app-mode) .runtime-title {
      margin: -18px -22px 0;
      border-radius: 0;
      padding: 10px 22px;
    }
    :host(.app-mode) .header {
      margin: 0 -22px 14px;
      padding: 16px 22px 14px;
      cursor: var(--jdbean-cursor-arrow), default;
    }
    :host(.app-mode) .window-dots,
    :host(.app-mode) .toggle,
    :host(.app-mode) .restore-pill {
      display: none !important;
    }
    :host(.app-mode) .title { font-size: 20px; }
    :host(.app-mode) .body { max-width: 1440px; margin: 0 auto; }
    :host(.app-mode) .source-summary { max-width: 720px; }
    :host(.app-mode) .table-wrap {
      max-height: calc(100vh - 430px);
      min-height: 260px;
    }
    .runtime-title {
      margin: -14px -14px 0;
      padding: 9px 16px 8px;
      border-radius: 26px 26px 0 0;
      border-bottom: 1px solid rgba(0,0,0,.08);
      background: linear-gradient(180deg, rgba(255,255,255,.86), rgba(245,245,247,.78));
      color: #6e6e73;
      font-size: 12px;
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      user-select: none;
    }
    .header {
      cursor: var(--jdbean-cursor-arrow), move;
      user-select: none;
      margin: 0 -14px 12px;
      padding: 13px 16px 12px;
      border-bottom: 1px solid rgba(0,0,0,.08);
      background: linear-gradient(180deg, rgba(248,248,250,.96), rgba(238,238,241,.92));
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      border-radius: 0;
    }
    .brand { display: flex; gap: 10px; align-items: center; min-width: 0; }
    .window-dots { display: flex; gap: 7px; align-items: center; margin-right: 2px; }
    .mark, .sub, .mini { display: none; }
    .title { font-size: 17px; font-weight: 700; white-space: nowrap; letter-spacing: -.2px; }
    .head-actions { display: flex; gap: 8px; align-items: center; min-width: 0; }
    .source-summary {
      max-width: 600px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #6e6e73;
      font-size: 12px;
    }
    .toggle { height: 28px; min-width: 32px; padding: 1px 10px; border-radius: 999px; }
    .body { overflow: visible; }
    fieldset {
      border: 1px solid rgba(0,0,0,.08);
      margin: 10px 0;
      padding: 10px;
      border-radius: 18px;
      background: rgba(255,255,255,.72);
    }
    legend { padding: 0 7px; font-weight: 700; color: #1d1d1f; }
    table { border-collapse: separate; border-spacing: 0; width: 100%; }
    th, td { border: 1px solid #e5e5ea; border-right: 0; border-bottom: 0; padding: 7px 9px; text-align: left; vertical-align: middle; }
    tr th:last-child, tr td:last-child { border-right: 1px solid #e5e5ea; }
    table tr:last-child th, table tr:last-child td { border-bottom: 1px solid #e5e5ea; }
    table tr:first-child th:first-child, table tr:first-child td:first-child { border-top-left-radius: 12px; }
    table tr:first-child th:last-child, table tr:first-child td:last-child { border-top-right-radius: 12px; }
    table tr:last-child th:first-child, table tr:last-child td:first-child { border-bottom-left-radius: 12px; }
    table tr:last-child th:last-child, table tr:last-child td:last-child { border-bottom-right-radius: 12px; }
    th { background: #f5f5f7; font-weight: 700; color: #3a3a3c; }
    label { white-space: nowrap; }
    input, select, button { font: inherit; }
    input[type="text"], input[type="url"], input[type="number"], input[type="datetime-local"], select {
      width: 100%;
      min-width: 0;
      height: 30px;
      border: 1px solid #d2d2d7;
      border-radius: 10px;
      padding: 3px 8px;
      background: rgba(255,255,255,.92);
      color: #1d1d1f;
    }
    button {
      white-space: nowrap;
      padding: 5px 14px;
      min-height: 30px;
      border: 1px solid rgba(0,0,0,.12);
      border-radius: 999px;
      background: #f5f5f7;
      color: #1d1d1f;
      cursor: var(--jdbean-cursor-hand), pointer;
    }
    button:hover:not(:disabled) { background: #e9e9ed; cursor: var(--jdbean-cursor-hand), pointer; }
    button:active:not(:disabled) { transform: translateY(1px); }
    button:disabled { opacity: .48; cursor: var(--jdbean-cursor-arrow), default; }
    button.btn-loading {
      background: #e6f0ff;
      color: #0a84ff;
      border-color: #b4d2ff;
      opacity: 1;
    }
    button.btn-loading::after {
      content: '';
      display: inline-block;
      width: 1em;
      text-align: left;
      animation: jdbean-loading-dots 1.2s steps(1, end) infinite;
    }
    @keyframes jdbean-loading-dots {
      0%   { content: ''; }
      25%  { content: '.'; }
      50%  { content: '..'; }
      75%, 100% { content: '...'; }
    }
    .detect-status.loading {
      color: #0a84ff;
      font-weight: 600;
    }
    .runtime-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .runtime-title-text {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
.window-dots button.window-dot {
      width: 12px;
      height: 12px;
      min-width: 12px;
      min-height: 12px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,.08);
      cursor: var(--jdbean-cursor-hand), pointer;
      line-height: 1;
    }
    .window-dots button.window-dot:hover { filter: brightness(.95); cursor: var(--jdbean-cursor-hand), pointer; }
    .window-dots button.window-dot:active { transform: scale(.92); }
    .dot-close { background: #ff5f57; }
    .dot-minimize { background: #ffbd2e; }
    .dot-zoom { background: #28c840; }
    .panel.maximized {
      top: 12px !important;
      left: 12px !important;
      transform: none !important;
      width: calc(100vw - 24px) !important;
      max-width: none !important;
      max-height: calc(100vh - 24px) !important;
    }
    .restore-pill {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      padding: 8px 14px;
      border-radius: 999px;
      box-shadow: 0 12px 36px rgba(0,0,0,.18);
      background: #fff;
    }
    .stats { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
    .stat {
      border: 1px solid rgba(0,0,0,.08);
      background: rgba(255,255,255,.78);
      padding: 10px 11px;
      min-height: 58px;
      border-radius: 18px;
      box-shadow: 0 1px 2px rgba(0,0,0,.04);
    }
    .stat b { display: block; font-size: 22px; line-height: 1; margin-bottom: 5px; letter-spacing: -.3px; }
    .stat span { color: #6e6e73; font-size: 12px; }
    .stat-hit { background: #effaf2; border-color: #b9e7c3; }
    .stat-hit b { color: #137333; }
    .stat-nohit { background: #fff6e8; border-color: #ffd9a3; }
    .stat-nohit b { color: #a15c00; }
    .stat-error { background: #fff0f0; border-color: #ffc9c9; }
    .stat-error b { color: #b3261e; }
    .stat-skipped { background: #f5f5f7; border-color: #d2d2d7; }
    .progress { height: 9px; border: 0; margin: 4px 0 10px; background: #e5e5ea; border-radius: 999px; overflow: hidden; }
    .bar { height: 100%; width: 0; background: #6e6e73; border-radius: 999px; }
    .form-table th { width: 86px; white-space: nowrap; }
    .form-table td { min-width: 120px; }
    .time-cell { width: 220px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .detect-status { color: #3a3a3c; font-size: 12px; overflow-wrap: anywhere; }
    .statusline {
      margin: 10px 0 7px;
      padding: 9px 12px;
      border: 1px solid rgba(0,0,0,.08);
      border-radius: 14px;
      background: rgba(245,245,247,.82);
      color: #3a3a3c;
      font-size: 12px;
    }
    .table-head { font-weight: 700; margin: 6px 0; color: #1d1d1f; }
    .result-section { contain: content; }
    .table-wrap {
      max-height: 430px;
      max-width: 100%;
      overflow: auto;
      border: 1px solid #e5e5ea;
      border-radius: 16px;
      background: #fff;
    }
    .table-wrap table.result-table {
      table-layout: fixed;
      width: max-content;
      min-width: 100%;
      border-collapse: separate;
    }
    .table-wrap table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f5f5f7;
      white-space: nowrap;
    }
    .table-wrap table th, .table-wrap table td {
      height: 38px;
      max-height: 38px;
      padding: 6px 8px;
      vertical-align: top;
    }
    .result-cell {
      display: block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      line-height: 1.4;
    }
    .result-cell-multiline {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      max-height: 38px;
      overflow: hidden;
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }
    .table-wrap tbody tr { height: 38px; }
    .col-status { width: 84px; }
    .col-event { width: 132px; }
    .col-tracker { width: 96px; }
    .col-erp { width: 110px; }
    .col-account { width: 150px; }
    .col-time { width: 158px; }
    .col-detail { width: 320px; }
    .table-wrap table tr:first-child th:first-child { border-top-left-radius: 15px; }
    .table-wrap table tr:first-child th:last-child { border-top-right-radius: 15px; }
    .table-wrap tbody tr:nth-child(even) { background: #fbfbfd; }
    .table-wrap tbody tr.result-hit { background: #f1fbf4; }
    .table-wrap tbody tr.result-nohit { background: #fff7eb; }
    .table-wrap tbody tr.result-error { background: #fff0f0; }
    .table-wrap tbody tr.result-skipped { background: #f7f7f8; color: #6e6e73; }
    .badge { display: inline-block; min-width: 54px; text-align: center; border-radius: 999px; padding: 3px 8px; font-weight: 700; }
    .badge-hit { color: #0b5d28; background: #dff4e5; border: 1px solid #a9dfb6; }
    .badge-nohit { color: #8a4b00; background: #ffe8c7; border: 1px solid #ffd39a; }
    .badge-error { color: #a50f0f; background: #ffdede; border: 1px solid #ffb8b8; }
    .badge-skipped { color: #555; background: #ededed; border: 1px solid #d2d2d7; }
    .ok { color: #0b5d28; font-weight: 700; }
    .bad { color: #a50f0f; font-weight: 700; }
    .muted { color: #6e6e73; }
    .th-cell { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .th-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .th-filter {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      min-height: 0;
      padding: 0;
      border-radius: 6px;
      border: 1px solid transparent;
      background: transparent;
      color: #6e6e73;
      font-size: 11px;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .th-filter:hover:not(:disabled) { background: #e9e9ed; color: #1d1d1f; }
    .th-filter.active { background: #0a84ff; color: #fff; border-color: #0a84ff; }
    .th-filter:disabled { opacity: .35; cursor: var(--jdbean-cursor-arrow), default; }
    .filter-popover {
      position: fixed;
      z-index: 2147483647;
      width: 240px;
      max-height: 360px;
      background: #fff;
      border: 1px solid rgba(0,0,0,.12);
      border-radius: 12px;
      box-shadow: 0 12px 36px rgba(0,0,0,.18);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12px;
    }
    .filter-popover-title { font-weight: 700; color: #1d1d1f; }
    .filter-popover input[type="text"] { height: 28px; }
    .filter-list {
      flex: 1 1 auto;
      overflow-y: auto;
      border: 1px solid #e5e5ea;
      border-radius: 8px;
      background: #fbfbfd;
      padding: 4px 0;
      max-height: 220px;
    }
    .filter-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      cursor: var(--jdbean-cursor-hand), pointer;
      white-space: nowrap;
    }
    .filter-item:hover { background: #eef4ff; }
    .filter-item input[type="checkbox"] { flex: 0 0 auto; margin: 0; }
    .filter-item-text {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .filter-item-count { flex: 0 0 auto; color: #6e6e73; font-variant-numeric: tabular-nums; }
    .filter-item-all { border-bottom: 1px solid #e5e5ea; font-weight: 600; }
    .filter-empty { padding: 8px; color: #6e6e73; text-align: center; }
    .filter-actions { display: flex; gap: 6px; justify-content: flex-end; }
    .filter-actions button { height: 26px; min-height: 0; padding: 0 10px; font-size: 12px; }
    .jd-footer {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 0;
      margin-top: 14px;
      padding: 12px 6px 2px;
      border-top: 1px solid rgba(0,0,0,.08);
      color: #86868b;
      font-size: 12px;
      line-height: 1.5;
    }
    .jd-footer a {
      color: #6e6e73;
      text-decoration: none;
      cursor: var(--jdbean-cursor-hand), pointer;
    }
    .jd-footer a:hover {
      color: #1d1d1f;
      text-decoration: underline;
    }
    .jd-footer .sep { margin: 0 8px; color: #c7c7cc; }
    .hidden, .collapsed { display: none !important; }
    @media (max-width: 980px) {
      .panel { width: calc(100vw - 20px); }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .form-table, .form-table tbody, .form-table tr, .form-table th, .form-table td { display: block; width: 100%; }
      .form-table th { border-bottom: 0; }
    }
  </style>
  <div class="panel" id="panel">
    <div class="runtime-title">
      <span class="runtime-title-text" id="runtimeTitle">京豆查询工具｜运行环境：Chrome / Edge（Chromium）扩展，Manifest V3</span>
    </div>
    <div class="header" id="dragHandle">
      <div class="brand">
        <div class="window-dots" role="group" aria-label="窗口控制">
          <button type="button" class="window-dot dot-close" id="closeBtn" title="隐藏面板" aria-label="隐藏面板"></button>
          <button type="button" class="window-dot dot-minimize" id="minimizeBtn" title="收起/展开" aria-label="收起或展开"></button>
          <button type="button" class="window-dot dot-zoom" id="zoomBtn" title="最大化/还原" aria-label="最大化或还原"></button>
        </div>
        <div>
          <div class="title">京豆查询工具</div>
          <div class="sub">CRM / Excel</div>
        </div>
      </div>
      <div class="head-actions">
        <span class="source-summary" id="sourceSummary">未选择</span>
        <button class="toggle" id="toggleBtn" title="收起/展开">−</button>
      </div>
    </div>

    <div class="body" id="body">
      <div class="stats">
        <div class="stat stat-total"><b id="sTotal">0</b><span>总数</span></div>
        <div class="stat stat-done"><b id="sDone">0</b><span>已查</span></div>
        <div class="stat stat-hit"><b id="sHit">0</b><span>命中</span></div>
        <div class="stat stat-nohit"><b id="sNoHit">0</b><span>未命中</span></div>
        <div class="stat stat-error"><b id="sError">0</b><span>异常</span></div>
        <div class="stat stat-skipped"><b id="sSkipped">0</b><span>跳过</span></div>
      </div>
      <div class="progress"><div class="bar" id="bar"></div></div>

      <fieldset>
        <legend>数据来源</legend>
        <table class="form-table">
          <tr>
            <th>数据范围</th>
            <td style="width:170px;">
              <select id="crmDateRange">
                <option value="today">今天关闭量</option>
                <option value="yesterday_today">昨天+今天关闭量</option>
              </select>
            </td>
            <th>CRM</th>
            <td style="width:150px;"><button id="loadCrmBtn">获取数据</button></td>
            <th>人员</th>
            <td style="width:230px;"><select id="crmPersonSelect" disabled><option value="">请先读取数据</option></select></td>
          </tr>
          <tr>
            <td colspan="6"><span class="detect-status" id="detectStatus">等待读取CRM数据。</span></td>
          </tr>
        </table>
        <div class="hidden" aria-hidden="true">
          <select id="accountCol"></select>
          <select id="eventCol"></select>
        </div>
      </fieldset>

      <fieldset>
        <legend>查询</legend>
        <table class="form-table">
          <tr>
            <th>请求来源</th>
            <td style="width:170px;">
              <select id="requestSource">
                <option value="jpos">jpos</option>
                <option value="kfuad">kfuad</option>
              </select>
            </td>
            <th>开始时间</th>
            <td class="time-cell"><input id="startTime" type="datetime-local" /></td>
            <th>截止时间</th>
            <td class="time-cell"><input id="endTime" type="datetime-local" /></td>
          </tr>
          <tr>
            <td colspan="6">
              <div class="actions">
                <button id="startBtn" disabled>开始</button>
                <button id="stopBtn" disabled>停止</button>
                <button id="exportBtn" disabled>导出CSV</button>
                <button id="clearBtn">重置</button>
              </div>
            </td>
          </tr>
        </table>
      </fieldset>

      <div class="statusline" id="log">等待读取CRM数据。</div>

      <section class="result-section">
        <div class="table-head"><span>查询结果</span></div>
        <div class="table-wrap">
          <table class="result-table">
            <colgroup>
              <col class="col-status" />
              <col class="col-event" />
              <col class="col-tracker" />
              <col class="col-erp" />
              <col class="col-account" />
              <col class="col-time" />
              <col class="col-detail" />
            </colgroup>
            <thead>
              <tr>
                <th data-col-key="status"><div class="th-cell"><span class="th-text">状态</span><button type="button" class="th-filter" data-col-key="status" title="筛选" aria-label="筛选 状态">▾</button></div></th>
                <th data-col-key="eventNo"><div class="th-cell"><span class="th-text">事件号</span><button type="button" class="th-filter" data-col-key="eventNo" title="筛选" aria-label="筛选 事件号">▾</button></div></th>
                <th data-col-key="trackerName"><div class="th-cell"><span class="th-text">追踪人</span><button type="button" class="th-filter" data-col-key="trackerName" title="筛选" aria-label="筛选 追踪人">▾</button></div></th>
                <th data-col-key="trackerErp"><div class="th-cell"><span class="th-text">ERP</span><button type="button" class="th-filter" data-col-key="trackerErp" title="筛选" aria-label="筛选 ERP">▾</button></div></th>
                <th data-col-key="account"><div class="th-cell"><span class="th-text">客户账户</span><button type="button" class="th-filter" data-col-key="account" title="筛选" aria-label="筛选 客户账户">▾</button></div></th>
                <th data-col-key="beanCreateTime"><div class="th-cell"><span class="th-text">京豆创建时间</span><button type="button" class="th-filter" data-col-key="beanCreateTime" title="筛选" aria-label="筛选 京豆创建时间">▾</button></div></th>
                <th data-col-key="detail">详细说明</th>
              </tr>
            </thead>
            <tbody id="resultBody"></tbody>
          </table>
        </div>
      </section>

      <footer class="jd-footer" aria-label="页脚信息">
        <a href="https://github.com/pitifulbug" target="_blank" rel="noopener noreferrer">2026 © 董昊. All rights reserved.</a>
        <span class="sep">|</span>
        <a href="http://status.woaiwusaqi.cn/" target="_blank" rel="noopener noreferrer">服务状态</a>
        <span class="sep">|</span>
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2025224440号</a>
      </footer>
    </div>
  </div>
  <button type="button" class="restore-pill hidden" id="restoreBtn">显示京豆查询工具</button>
  <div class="filter-popover hidden" id="filterPopover" role="dialog" aria-label="筛选">
    <div class="filter-popover-title" id="filterPopoverTitle">筛选</div>
    <input type="text" id="filterPopoverSearch" placeholder="搜索…" />
    <div class="filter-list" id="filterPopoverList"></div>
    <div class="filter-actions">
      <button type="button" id="filterPopoverClear">清除</button>
      <button type="button" id="filterPopoverCancel">取消</button>
      <button type="button" id="filterPopoverApply">确定</button>
    </div>
  </div>
`;
}
