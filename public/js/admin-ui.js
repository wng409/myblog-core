// 后台通用 UI 组件：鸿蒙风自定义下拉框
// 说明：原生 <select> 被 CSS 隐藏，但仍承载表单真值；点击 <li> 时把值写回 select 并派发 change，
//       因此表单提交、原有 JS 校验逻辑都不受影响。
(function () {
  'use strict';

  var DROP_MAX = 250;   // 与 CSS max-height 一致

  function initOne(container) {
    if (!container || container.dataset.hmReady === '1') return;
    var select = container.querySelector('select');
    var trigger = container.querySelector('.hm-select-trigger');
    var triggerText = container.querySelector('.trigger-text');
    var optionsList = container.querySelector('.hm-select-options');
    if (!select || !trigger || !triggerText || !optionsList) return;
    container.dataset.hmReady = '1';

    function syncTrigger() {
      var opt = select.options[select.selectedIndex];
      triggerText.textContent = opt ? opt.text : '（无可选项）';
      Array.prototype.forEach.call(optionsList.children, function (el) {
        el.classList.toggle('is-selected', !!opt && el.dataset.value === opt.value);
      });
    }

    function render() {
      optionsList.innerHTML = '';
      Array.prototype.forEach.call(select.options, function (opt) {
        var li = document.createElement('li');
        li.textContent = opt.text;
        li.dataset.value = opt.value;
        li.addEventListener('click', function (e) {
          e.stopPropagation();
          select.value = opt.value;
          // 派发 change，保证外部校验/联动能收到
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncTrigger();
          container.classList.remove('is-open');
        });
        optionsList.appendChild(li);
      });
      syncTrigger();
    }

    render();

    // 原生 select 被外部代码改值/选项变化时保持同步
    select.addEventListener('change', syncTrigger);

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = !container.classList.contains('is-open');

      // 关闭其它已展开的下拉
      document.querySelectorAll('.hm-select-container.is-open').forEach(function (c) {
        if (c !== container) c.classList.remove('is-open');
      });

      container.classList.toggle('is-open', willOpen);
      if (!willOpen) return;

      // 视口空间不足 → 向上展开，避免菜单超出屏幕
      container.classList.remove('drop-up');
      var rect = trigger.getBoundingClientRect();
      var menuH = Math.min(optionsList.scrollHeight || DROP_MAX, DROP_MAX);
      if (rect.bottom + 8 + menuH > window.innerHeight - 8) {
        container.classList.add('drop-up');
      }
    });

    // 重新渲染入口（Banner 动态行选项可能变化）
    container._hmRender = render;
  }

  function initHarmonySelects(root) {
    (root || document).querySelectorAll('.hm-select-container').forEach(initOne);
  }

  // 点击页面其它位置收起
  document.addEventListener('click', function () {
    document.querySelectorAll('.hm-select-container.is-open').forEach(function (c) {
      c.classList.remove('is-open');
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    initHarmonySelects();

    // 动态新增的节点（如「添加 Banner」克隆的行）自动初始化
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          if (n.classList && n.classList.contains('hm-select-container')) initOne(n);
          else if (n.querySelectorAll) initHarmonySelects(n);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });

  window.initHarmonySelects = initHarmonySelects;
})();