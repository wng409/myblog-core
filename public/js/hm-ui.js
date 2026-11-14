/**
 * 鸿蒙风格全局弹窗（hm-ui.js）
 * ------------------------------------------------------------
 * 对外 API：
 *   showHmModal(options)   底层渲染入口，支持任意数量的按钮（actions 数组）
 *   hmAlert(desc, title, options)          单按钮提示，Promise<true>
 *   hmConfirm(desc, title, options)        确认框，Promise<boolean>
 *
 * actions 数组元素：
 *   { text: '暂不删除', value: false, type: 'cancel' }
 *   type 取 cancel | primary | danger | caution | success，决定配色（鸿蒙语义色）
 *   autofocus: true 可指定默认聚焦的按钮
 *
 * 内置能力：
 *   1. 接管全站原生 alert（window.HM_UI_CONFIG.noAlertOverride 可关闭）
 *   2. 接管 form[data-confirm] / 按钮[data-confirm] 二次确认（document 级事件委托，
 *      SSE 静默刷新重建 DOM 后依然生效；支持按钮上的 formaction/formmethod）
 *      文案可用 data-confirm-ok / data-confirm-cancel / data-confirm-type 定制
 *   3. 外链离开本站前的提示 + 免责声明（可选关闭）
 *   4. 统一消费后端 ?msg= / ?err= 提示，弹一次后自动清理 URL
 *
 * 约束：
 *   - CSP 严格模式：不注入内联 script、不使用行内事件属性；
 *   - 弹窗 DOM 由 JS 按需注入，模板零侵入；
 *   - 静态站导出（SSG）同样可用，不依赖服务端变量。
 */
(function () {
  'use strict';

  if (window.__hmUiReady) return;
  window.__hmUiReady = true;

  var CONFIG = window.HM_UI_CONFIG || {};
  var INTERCEPT_EXTERNAL = CONFIG.interceptExternalLinks !== false;
  var SAFE_HOSTS = (Array.isArray(CONFIG.safeHosts) ? CONFIG.safeHosts : []).slice();
  var BYPASS_KEY = 'hm_ext_bypass_';
  var DISCLAIMER = CONFIG.disclaimer ||
    '请注意，外部网站的安全性和隐私政策与本博客无关。';

  // 命中这些关键词的文案按「危险操作」渲染（红色主按钮、默认聚焦取消）
  var DANGER_RE = /删除|清空|彻底|不可恢复|移除|注销|释放|覆盖|禁用/;
  var CAUTION_RE = /退出|重置|离开|切换|修改/;

  var TONE_ICON = { primary: 'i', success: '✓', caution: '!', danger: '×' };

  var MODAL_HTML = '' +
    '<div id="hm-global-modal" class="hm-modal" aria-hidden="true">' +
    '  <div class="hm-modal-overlay"></div>' +
    '  <div class="hm-modal-content" role="dialog" aria-modal="true"' +
    '       aria-labelledby="hm-title" aria-describedby="hm-desc" tabindex="-1">' +
    '    <div class="hm-modal-body">' +
    '      <div class="hm-modal-icon" id="hm-icon" hidden></div>' +
    '      <h3 class="hm-modal-title" id="hm-title">提示</h3>' +
    '      <p class="hm-modal-desc" id="hm-desc"></p>' +
    '      <div class="hm-modal-url" id="hm-url-box" hidden></div>' +
    '      <div class="hm-modal-note" id="hm-note" hidden></div>' +
    '    </div>' +
    '    <div class="hm-modal-actions" id="hm-actions"></div>' +
    '  </div>' +
    '</div>';

  var modal = null;
  var elContent = null;
  var elIcon = null;
  var elTitle = null;
  var elDesc = null;
  var elUrl = null;
  var elNote = null;
  var elActions = null;

  var resolver = null;
  var lastFocused = null;
  var prevOverflow = '';
  var isOpen = false;

  function ready(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function inject() {
    if (modal) return;
    document.body.insertAdjacentHTML('beforeend', MODAL_HTML);

    modal = document.getElementById('hm-global-modal');
    elContent = modal.querySelector('.hm-modal-content');
    elIcon = document.getElementById('hm-icon');
    elTitle = document.getElementById('hm-title');
    elDesc = document.getElementById('hm-desc');
    elUrl = document.getElementById('hm-url-box');
    elNote = document.getElementById('hm-note');
    elActions = document.getElementById('hm-actions');

    modal.querySelector('.hm-modal-overlay').addEventListener('click', function () { close(false); });
    document.addEventListener('keydown', onKeydown, true);
  }

  function visibleButtons() {
    if (!elActions) return [];
    return Array.prototype.slice.call(elActions.querySelectorAll('.hm-btn'));
  }

  function onKeydown(e) {
    if (!isOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(false);
      return;
    }

    // 焦点陷阱：Tab 只在弹窗内循环，避免焦点跑到背后的页面
    if (e.key !== 'Tab') return;
    var focusables = visibleButtons();
    if (!focusables.length) return;

    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = document.activeElement;

    if (!modal.contains(active)) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function focusEl(el) {
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch (err) {
      try { el.focus(); } catch (e) { /* 忽略 */ }
    }
  }

  // ---------- actions 归一化 ----------
  // 兼容旧调用：hideCancel / confirmText / cancelText / isDanger
  function normalizeActions(options) {
    if (Array.isArray(options.actions) && options.actions.length) {
      return options.actions.map(function (a) {
        return {
          text: a.text == null ? '确定' : String(a.text),
          value: typeof a.value === 'undefined' ? true : a.value,
          type: a.type || 'primary',
          autofocus: !!a.autofocus
        };
      });
    }

    var danger = !!options.isDanger;
    var list = [];
    if (!options.hideCancel) {
      list.push({ text: options.cancelText || '取消', value: false, type: 'cancel' });
    }
    list.push({
      text: options.confirmText || (danger ? '确认执行' : '确定'),
      value: true,
      type: danger ? 'danger' : 'primary'
    });
    return list;
  }

  function normalizeTone(tone) {
    return TONE_ICON[tone] ? tone : '';
  }

  function renderActions(actions) {
    elActions.innerHTML = '';
    // 超过两个按钮时纵向排列，避免中文按钮在窄屏被挤成两行字
    elActions.dataset.count = String(actions.length);

    actions.forEach(function (action, index) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hm-btn hm-btn-' + (action.type || 'primary');
      btn.textContent = action.text;
      btn.dataset.hmIndex = String(index);
      btn.addEventListener('click', function () { close(action.value); });
      elActions.appendChild(btn);
    });
  }

  function pickFocusTarget(actions, tone) {
    var buttons = visibleButtons();
    if (!buttons.length) return null;

    for (var i = 0; i < actions.length; i++) {
      if (actions[i].autofocus && buttons[i]) return buttons[i];
    }
    // 危险 / 警告类：默认聚焦「取消」这类安全出口
    if (tone === 'danger' || tone === 'caution') {
      for (var j = 0; j < actions.length; j++) {
        if (actions[j].type === 'cancel' && buttons[j]) return buttons[j];
      }
    }
    for (var k = 0; k < actions.length; k++) {
      if (actions[k].type !== 'cancel' && buttons[k]) return buttons[k];
    }
    return buttons[0];
  }

  function openModal(options) {
    options = options || {};
    return new Promise(function (resolve) {
      ready(function () {
        inject();

        // 极端并发下同一时刻只保留一个弹窗，旧弹窗按「取消」收尾，避免 Promise 悬挂
        if (isOpen) close(false);

        resolver = resolve;
        lastFocused = document.activeElement;

        var tone = normalizeTone(options.tone);
        var actions = normalizeActions(options);

        elTitle.textContent = options.title || '提示';

        var desc = options.desc == null ? '' : String(options.desc);
        if (options.url && !desc) desc = '您即将离开本站，前往以下外部网站：';
        elDesc.textContent = desc;
        elDesc.hidden = !desc;

        if (options.url) {
          elUrl.textContent = String(options.url);
          elUrl.hidden = false;
        } else {
          elUrl.textContent = '';
          elUrl.hidden = true;
        }

        // 免责声明 / 补充说明（外链场景必显）
        if (options.note) {
          elNote.textContent = String(options.note);
          elNote.hidden = false;
          elNote.className = 'hm-modal-note hm-note-' + (options.noteType || 'danger');
        } else {
          elNote.textContent = '';
          elNote.hidden = true;
        }

        if (tone) {
          elIcon.textContent = TONE_ICON[tone];
          elIcon.className = 'hm-modal-icon hm-icon-' + tone;
          elIcon.hidden = false;
        } else {
          elIcon.hidden = true;
          elIcon.textContent = '';
        }

        renderActions(actions);

        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');

        prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        isOpen = true;

        var target = pickFocusTarget(actions, tone);
        focusEl(elContent);
        setTimeout(function () { focusEl(target); }, 40);
      });
    });
  }

  function close(result) {
    if (!isOpen) return;
    isOpen = false;

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = prevOverflow;
    prevOverflow = '';

    var resolve = resolver;
    resolver = null;

    var toFocus = lastFocused;
    lastFocused = null;

    if (resolve) resolve(result);

    if (toFocus && toFocus.focus && document.contains(toFocus)) focusEl(toFocus);
  }

  function navigate(url, target) {
    if (!url) return;
    if (target === '_blank') window.open(url, '_blank', 'noopener,noreferrer');
    else window.location.href = url;
  }

  // ================= 公共 API =================

  window.showHmModal = function (options) {
    return openModal(options);
  };

  window.hmAlert = function (desc, title, options) {
    options = options || {};
    return openModal({
      title: title || '提示',
      desc: desc == null ? '' : String(desc),
      tone: options.tone || 'primary',
      actions: [{
        text: options.okText || '我知道了',
        value: true,
        type: options.okType || 'primary'
      }]
    });
  };

  // 第三参数兼容旧写法：true/false 视为 isDanger，对象则按新配置解析
  window.hmConfirm = function (desc, title, options) {
    var legacyDanger = options === true;
    var opts = (options && typeof options === 'object') ? options : {};

    var type = opts.type || opts.okType || (legacyDanger || opts.isDanger ? 'danger' : 'primary');
    var danger = type === 'danger';

    return openModal({
      title: title || opts.title || (danger ? '危险操作' : '请确认'),
      desc: desc == null ? '' : String(desc),
      tone: opts.tone || (danger ? 'caution' : 'primary'),
      actions: [
        { text: opts.cancelText || '取消', value: false, type: 'cancel' },
        { text: opts.okText || (danger ? '确认执行' : '确定'), value: true, type: type }
      ]
    });
  };

  window.hmUi = {
    alert: window.hmAlert,
    confirm: window.hmConfirm,
    show: window.showHmModal
  };

  // ================= 接管 data-confirm =================
  // 用 document 级事件委托：SSE 静默刷新 / 动态插入的表单同样生效。

  function confirmTargetOf(form, submitter) {
    // 按钮级 data-confirm 优先（如「删除背景」按钮 = submit + formaction）
    if (submitter && submitter.getAttribute && submitter.getAttribute('data-confirm')) {
      return submitter;
    }
    if (form && form.getAttribute && form.getAttribute('data-confirm')) return form;
    return null;
  }

  function confirmOptionsFor(el, msg) {
    var type = el.getAttribute('data-confirm-type');
    if (!type) {
      if (DANGER_RE.test(msg)) type = 'danger';
      else if (CAUTION_RE.test(msg)) type = 'caution';
      else type = 'primary';
    }

    var title = el.getAttribute('data-confirm-title') ||
      (type === 'danger' ? '危险操作' : (type === 'caution' ? '请确认' : '提示'));
    var okText = el.getAttribute('data-confirm-ok') ||
      (type === 'danger' ? '确认执行' : '确定');
    var cancelText = el.getAttribute('data-confirm-cancel') || '取消';

    return {
      title: title,
      desc: msg,
      tone: type === 'danger' ? 'caution' : (type === 'caution' ? 'caution' : 'primary'),
      actions: [
        { text: cancelText, value: false, type: 'cancel' },
        { text: okText, value: true, type: type }
      ]
    };
  }

  // 提交表单：必须保留 submitter 上的 formaction / formmethod / formtarget
  // （站点设置页「删除背景」按钮就是 submit + formaction，用 form.submit() 会丢失目标地址）
  function submitForm(form, submitter) {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit(submitter || undefined);
      return;
    }

    var attrs = ['action', 'method', 'target'];
    var patched = [];
    if (submitter) {
      var map = { action: 'formaction', method: 'formmethod', target: 'formtarget' };
      attrs.forEach(function (name) {
        var val = submitter.getAttribute(map[name]);
        if (val) {
          patched.push([name, form.getAttribute(name)]);
          form.setAttribute(name, val);
        }
      });
    }

    form.submit();

    patched.forEach(function (pair) {
      if (pair[1] === null) form.removeAttribute(pair[0]);
      else form.setAttribute(pair[0], pair[1]);
    });
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.nodeName !== 'FORM') return;
    if (e.defaultPrevented) return;
    if (form.dataset.hmConfirmed === '1') return;

    var submitter = e.submitter || null;
    var holder = confirmTargetOf(form, submitter);
    if (!holder) return;

    var msg = holder.getAttribute('data-confirm') || '';
    if (!msg) return;

    e.preventDefault();

    var opts = confirmOptionsFor(holder, msg);

    window.showHmModal(opts).then(function (result) {
      if (!result) return;

      form.dataset.hmConfirmed = '1';
      try {
        submitForm(form, submitter);
      } finally {
        // requestSubmit 会同步派发 submit 事件，事件结束后即可清除放行标记
        setTimeout(function () { delete form.dataset.hmConfirmed; }, 0);
      }
    });
  });

  // ================= 接管链接：data-confirm / 外链提示 =================

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var target = e.target;
    if (!target || target.nodeType !== 1 || typeof target.closest !== 'function') return;

    var a = target.closest('a[href]');
    if (!a) return;
    if (a.hasAttribute('download') || a.hasAttribute('data-hm-allow')) return;

    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(href)) return;

    // 1) 带 data-confirm 的链接：先确认再跳转
    var confirmMsg = a.getAttribute('data-confirm');
    if (confirmMsg) {
      e.preventDefault();
      window.showHmModal(confirmOptionsFor(a, confirmMsg)).then(function (ok) {
        if (ok) navigate(a.href, a.getAttribute('target'));
      });
      return;
    }

    // 2) 外链拦截
    if (!INTERCEPT_EXTERNAL) return;
    if (!/^(https?:)?\/\//i.test(href)) return;          // 站内相对路径直接放行
    if (window.location.protocol === 'file:') return;    // 本地双击打开不拦截

    var url;
    try {
      url = new URL(a.href, window.location.href);
    } catch (err) {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.hostname === window.location.hostname) return;
    if (SAFE_HOSTS.indexOf(url.hostname) !== -1) return;

    try {
      if (sessionStorage.getItem(BYPASS_KEY + url.hostname)) return;
    } catch (err) { /* 隐私模式禁用 storage 时忽略 */ }

    e.preventDefault();
    a.setAttribute('rel', 'noopener noreferrer');

    var targetAttr = a.getAttribute('target');
    window.showHmModal({
      title: '离开本站',
      desc: '您即将离开本站，前往以下外部网站：',
      url: url.href,
      note: DISCLAIMER,
      noteType: 'danger',
      tone: 'primary',
      actions: [
        { text: '留在此页', value: false, type: 'cancel' },
        { text: '继续前往', value: true, type: 'primary' }
      ]
    }).then(function (ok) {
      if (!ok) return;
      try { sessionStorage.setItem(BYPASS_KEY + url.hostname, '1'); } catch (err) {}
      navigate(url.href, targetAttr);
    });
  });

  // ================= 统一消费后端 msg / err 提示 =================
  // 后端仍以 redirect + ?msg= / ?err= 的形式传话；这里弹出一次后把参数从地址栏抹掉，
  // 避免用户刷新页面时重复弹窗。

  function drainFlash() {
    var url;
    try {
      url = new URL(window.location.href);
    } catch (err) {
      return;
    }

    var msg = url.searchParams.get('msg');
    var err = url.searchParams.get('err');
    if (!msg && !err) return;

    url.searchParams.delete('msg');
    url.searchParams.delete('err');
    var clean = url.pathname + (url.search || '') + url.hash;
    try { window.history.replaceState(null, '', clean); } catch (e) { /* 忽略 */ }

    if (err) {
      window.showHmModal({
        title: '操作未完成',
        desc: err,
        tone: 'danger',
        actions: [{ text: '我知道了', value: true, type: 'danger' }]
      });
    } else {
      window.showHmModal({
        title: '操作成功',
        desc: msg,
        tone: 'success',
        actions: [{ text: '好的', value: true, type: 'success' }]
      });
    }
  }

  // ================= 原生 alert 接管 =================
  if (!CONFIG.noAlertOverride) {
    window.alert = function (msg) {
      return window.hmAlert(msg == null ? '' : String(msg));
    };
  }

  ready(function () {
    setTimeout(drainFlash, 0);
  });
})();