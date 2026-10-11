// ============================================================
// 后台 Toast 通知（底部居中，带进度条，悬停暂停）
// ============================================================
(function () {
  var LANG = (document.body && document.body.dataset.lang) || 'zh';
  var DICT = {
    zh: { success: '成功', error: '错误', newDevice: '检测到新设备登录', unknown: '未知' },
    en: { success: 'Success', error: 'Error', newDevice: 'New device login detected', unknown: 'Unknown' }
  };
  var tr = function (k) { return ((DICT[LANG] || DICT.zh)[k] || k); };
  var LOCALE = LANG === 'en' ? 'en-US' : 'zh-CN';

  window.showToast = function (title, message, type) {
    if (typeof message === 'undefined' || message === null) message = '';
    if (message === 'success' || message === 'error') {
      type = message;
      message = '';
    }
    if (!type) type = 'success';

    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const duration = type === 'error' ? 5000 : 3000;

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;

    const icon = document.createElement('i');
    icon.className = type === 'error'
      ? 'fas fa-times-circle toast-icon'
      : 'fas fa-check-circle toast-icon';

    const body = document.createElement('div');
    body.className = 'toast-body';
    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title || '';
    body.appendChild(titleEl);
    if (message) {
      const msgEl = document.createElement('div');
      msgEl.className = 'toast-message';
      msgEl.textContent = message;
      body.appendChild(msgEl);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';

    const progress = document.createElement('div');
    progress.className = 'toast-progress';

    toast.appendChild(icon);
    toast.appendChild(body);
    toast.appendChild(closeBtn);
    toast.appendChild(progress);
    container.appendChild(toast);

    // ====== 计时器管理（支持暂停/恢复）======
    let startTime = Date.now();
    let remaining = duration;
    let timer = null;

    function startTimer(ms) {
      startTime = Date.now();
      remaining = ms;
      timer = setTimeout(function () { removeToast(); }, ms);
    }

    function pauseTimer() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      remaining -= (Date.now() - startTime);
      if (remaining < 0) remaining = 0;
      // 暂停进度条
      progress.style.animationPlayState = 'paused';
    }

    function resumeTimer() {
      if (timer) return;
      if (remaining <= 0) {
        removeToast();
        return;
      }
      startTimer(remaining);
      progress.style.animationPlayState = 'running';
    }

    function removeToast() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!toast.parentNode) return;
      toast.classList.add('toast-hide');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }

    // 悬停暂停 / 离开恢复
    toast.addEventListener('mouseenter', pauseTimer);
    toast.addEventListener('mouseleave', resumeTimer);
    closeBtn.onclick = removeToast;

    // 启动进度条动画（宽度 100% → 0%）
    progress.style.animationDuration = duration + 'ms';
    requestAnimationFrame(function () {
      progress.classList.add('toast-progress-run');
    });

    // 启动计时器
    startTimer(duration);
  };

  // 页面加载时从 URL 读 msg / err
  document.addEventListener('DOMContentLoaded', function () {
    const params = new URLSearchParams(location.search);
    const msg = params.get('msg');
    const err = params.get('err');

    if (msg) window.showToast(tr('success'), msg, 'success');
    if (err) window.showToast(tr('error'), err, 'error');

    if (msg || err) {
      const url = new URL(location.href);
      url.searchParams.delete('msg');
      url.searchParams.delete('err');
      history.replaceState({}, '', url.toString());
    }

    // 新设备登录通知
    const deviceEl = document.getElementById('device-notice-data');
    if (deviceEl) {
      const ip = deviceEl.dataset.ip || tr('unknown');
      const ua = deviceEl.dataset.ua || tr('unknown');
      const ts = parseInt(deviceEl.dataset.ts || '0', 10);
      const shortUa = ua.length > 80 ? ua.slice(0, 80) + '...' : ua;
      const timeStr = ts ? new Date(ts).toLocaleString(LOCALE, { hour12: false }) : '';
      const detail = `IP ${ip} | ${shortUa}${timeStr ? ' | ' + timeStr : ''}`;
      window.showToast(tr('newDevice'), detail, 'error');
      deviceEl.remove();
    }
  });
})();