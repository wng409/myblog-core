// 操作日志页交互：设备识别 / 搜索过滤 / 筛选抽屉 / 详情抽屉（仅移动端）/ SSE 静默局部刷新
(function () {
  'use strict';

  // ==================== 设备 & 浏览器识别 ====================
  var OS_RULES = [
    { name: 'HarmonyOS', icon: 'fa-mobile-alt', re: /OpenHarmony|HarmonyOS|ArkWeb/i },
    { name: 'Android',   icon: 'fa-mobile-alt', re: /Android/i },
    { name: 'iOS',       icon: 'fa-mobile-alt', re: /iPhone|iPad|iPod|iOS/i },
    { name: 'Windows',   icon: 'fa-desktop',    re: /Windows NT|Windows/i },
    { name: 'macOS',     icon: 'fa-laptop',     re: /Macintosh|Mac OS X/i },
    { name: 'Linux',     icon: 'fa-linux',      re: /Linux|X11/i }
  ];
  var BROWSER_RULES = [
    { name: 'ArkWeb',  re: /ArkWeb/i },
    { name: 'Edge',    re: /Edg\//i },
    { name: 'Chrome',  re: /Chrome\/|CriOS/i },
    { name: 'Firefox', re: /Firefox\/|FxiOS/i },
    { name: 'Safari',  re: /Safari\//i },
    { name: 'curl',    re: /curl\//i },
    { name: 'Node',    re: /node|axios|undici/i }
  ];

  function detectOS(ua) {
    for (var i = 0; i < OS_RULES.length; i++) {
      if (OS_RULES[i].re.test(ua)) return OS_RULES[i];
    }
    return { name: '未知系统', icon: 'fa-question-circle' };
  }
  function detectBrowser(ua) {
    for (var i = 0; i < BROWSER_RULES.length; i++) {
      if (BROWSER_RULES[i].re.test(ua)) return BROWSER_RULES[i].name;
    }
    return '未知浏览器';
  }

  function fillUA() {
    Array.prototype.forEach.call(document.querySelectorAll('.log-ua'), function (el) {
      var ua = el.getAttribute('data-ua') || '';
      var os = detectOS(ua);
      var br = detectBrowser(ua);
      var icon = el.querySelector('i');
      if (icon) icon.className = 'fas ' + os.icon;
      var label = el.querySelector('.ua-label');
      if (label) label.textContent = os.name + ' / ' + br;
    });
  }

  // ==================== 抽屉开关 ====================
  function bindSheet(openBtnId, sheetId, maskId, closeId) {
    var openBtn = document.getElementById(openBtnId);
    var sheet = document.getElementById(sheetId);
    var mask = document.getElementById(maskId);
    var closeBtn = closeId ? document.getElementById(closeId) : null;
    if (!sheet) return { open: function () {}, close: function () {} };

    function open() {
      sheet.classList.add('open');
      if (mask) mask.classList.add('show');
    }
    function close() {
      sheet.classList.remove('open');
      if (mask) mask.classList.remove('show');
    }
    if (openBtn) openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (mask) mask.addEventListener('click', close);
    return { open: open, close: close };
  }

  bindSheet('logFilterToggle', 'logFilterPanel', 'logFilterMask', 'logFilterClose');
  var detailSheet = bindSheet(null, 'logDetailSheet', 'logDetailMask', 'logDetailClose');

  // ==================== 详情（仅移动端） ====================
  function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  }
  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val || '—';
  }
  function openDetail(row) {
    setText('detailId', row.getAttribute('data-id'));
    setText('detailUser', row.getAttribute('data-user'));
    setText('detailAction', row.getAttribute('data-action'));
    setText('detailTarget', row.getAttribute('data-target'));
    setText('detailIp', row.getAttribute('data-ip'));
    setText('detailTime', row.getAttribute('data-time'));
    setText('detailUa', row.getAttribute('data-ua'));

    var deviceEl = document.getElementById('detailDevice');
    if (deviceEl) {
      var ua = row.getAttribute('data-ua') || '';
      deviceEl.textContent = detectOS(ua).name + ' / ' + detectBrowser(ua);
    }
    detailSheet.open();
  }

  // 列表容器：静默刷新只替换它的 innerHTML，元素本身保留，故事件可安全委托到它上面
  var listWrapper = document.getElementById('logListWrapper');

  if (listWrapper) {
    listWrapper.addEventListener('click', function (e) {
      if (!isMobileViewport()) return;   // PC 端点击不弹窗
      var row = e.target.closest('.log-row');
      if (row) openDetail(row);
    });
  }

  // ==================== 搜索过滤（纯前端） ====================
  var searchInput = document.getElementById('logSearch');

  // 抽成可重跑的纯函数：静默刷新后需重新应用当前搜索词
  function applySearchFilter() {
    var logList = document.getElementById('logList');   // 实时取，防止刷新后引用失效
    if (!logList) return;
    var kw = ((searchInput && searchInput.value) || '').trim().toLowerCase();
    Array.prototype.forEach.call(logList.querySelectorAll('.log-row'), function (row) {
      var hay = (row.getAttribute('data-search') || '').toLowerCase();
      row.style.display = (!kw || hay.indexOf(kw) !== -1) ? '' : 'none';
    });
  }

  if (searchInput) searchInput.addEventListener('input', applySearchFilter);

  // 刷新按钮：用户主动整页刷新
  var refreshBtn = document.getElementById('logRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', function () { location.reload(); });

  // 说明：core（开源版）不提供 SSE 接口，故此处不建立 EventSource 连接；
  // 刷新通过工具栏的「刷新」按钮整页重载完成。

  // ==================== 初始化 ====================
  fillUA();
  applySearchFilter();
})();