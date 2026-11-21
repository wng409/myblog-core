// 站点设置页交互：主题色联动 / 头像预览 / 文件名回显
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    // ---------- 主题色：色块 ↔ 文本联动 ----------
    var colorInput = document.getElementById('themeColorInput');
    var colorText = document.getElementById('themeColorText');
    var colorPreview = document.getElementById('themeColorPreview');
    if (colorInput) {
      colorInput.addEventListener('input', function () {
        if (colorText) colorText.value = colorInput.value;
        if (colorPreview) colorPreview.style.background = colorInput.value;
      });
    }

    // ---------- 头像预览（CSP 禁 blob:，用 data: URL） ----------
    var avatarFile = document.getElementById('avatarFile');
    var avatarPreview = document.getElementById('avatarPreview');
    if (avatarFile && avatarPreview) {
      avatarFile.addEventListener('change', function () {
        var f = this.files && this.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          avatarPreview.innerHTML = '<img alt="avatar">';
          var img = avatarPreview.querySelector('img');
          if (img) img.src = e.target.result;
        };
        reader.readAsDataURL(f);
      });
    }

    // ---------- 文件选择按钮：点击触发隐藏 input，选择后回显文件名 ----------
    document.querySelectorAll('[data-file-target]').forEach(function (btn) {
      var input = document.getElementById(btn.getAttribute('data-file-target'));
      if (!input) return;

      btn.addEventListener('click', function () { input.click(); });

      input.addEventListener('change', function () {
        var nameEl = document.getElementById(btn.getAttribute('data-file-name') || '');
        if (!nameEl) {
          var wrap = btn.closest('.upload-actions');
          nameEl = wrap ? wrap.querySelector('.file-name') : null;
        }
        if (!nameEl) return;
        var names = Array.prototype.map.call(this.files || [], function (f) { return f.name; });
        nameEl.textContent = names.length ? names.join('、') : '';
      });
    });
  });
})();
// ============================================================
// 社交链接编辑器（站点设置页）
// 说明：模板中已有 #socialEditor / #socialLinksInput / #socialRowTpl，
//       但此前没有脚本驱动，导致「添加社交链接」无反应、提交会清空已有链接。
// ============================================================
(function () {
  'use strict';

  var SOCIAL_ICONS = {
    github: 'fab fa-github',
    email: 'fas fa-envelope',
    bilibili: 'fab fa-bilibili',
    zhihu: 'fab fa-zhihu',
    x: 'fab fa-x-twitter',
    telegram: 'fab fa-telegram',
    wechat: 'fab fa-weixin',
    link: 'fas fa-link'
  };

  function init() {
    var editor = document.getElementById('socialEditor');
    var hidden = document.getElementById('socialLinksInput');
    var tpl = document.getElementById('socialRowTpl');
    var addBtn = document.getElementById('socialAddBtn');
    if (!editor || !hidden || !tpl || !addBtn) return;

    var emptyText = editor.dataset.empty || '暂无社交链接';

    function syncRow(row) {
      var select = row.querySelector('select.social-type');
      var icon = row.querySelector('.social-icon');
      var url = row.querySelector('.social-url');
      if (!select || !url) return;

      // 「自定义」选项显示名（模板中该 option 文本为空）
      var linkOpt = select.querySelector('option[value="link"]');
      if (linkOpt && !linkOpt.text) linkOpt.text = editor.dataset.custom || '自定义链接';

      var type = select.value || 'link';
      if (icon) icon.className = 'social-icon ' + (SOCIAL_ICONS[type] || SOCIAL_ICONS.link);

      url.placeholder = editor.dataset.urlPh || '链接地址';
      if (type === 'email') {
        if (url.value.trim() && !/^mailto:/i.test(url.value.trim())) {
          url.value = 'mailto:' + url.value.trim();
        }
        url.placeholder = 'mailto:you@example.com';
      }
    }

    function syncAll() {
      Array.prototype.forEach.call(editor.querySelectorAll('.social-row'), syncRow);
      // 让 admin-ui 的 MutationObserver 之外再主动同步一次自定义下拉
      Array.prototype.forEach.call(editor.querySelectorAll('.hm-select-container'), function (c) {
        if (typeof c._hmRender === 'function') c._hmRender();
      });
    }

    function collect() {
      var out = [];
      Array.prototype.forEach.call(editor.querySelectorAll('.social-row'), function (row) {
        var select = row.querySelector('select.social-type');
        var url = row.querySelector('.social-url');
        var value = url ? url.value.trim() : '';
        if (!value) return;
        out.push({ type: select ? select.value : 'link', url: value });
      });
      return out;
    }

    function addRow(item) {
      var frag = tpl.content.cloneNode(true);
      var row = frag.querySelector('.social-row');
      if (!row) return;

      var select = row.querySelector('select.social-type');
      var url = row.querySelector('.social-url');
      if (item) {
        if (select) select.value = item.type || 'link';
        if (url) url.value = item.url || '';
      }

      editor.appendChild(frag);
      syncAll();
    }

    // 初始渲染：已有链接；为空时给一行空行方便直接填
    var initial = [];
    try { initial = JSON.parse(editor.dataset.links || '[]'); } catch (e) { initial = []; }
    if (Array.isArray(initial) && initial.length) initial.forEach(addRow);
    else addRow(null);

    addBtn.addEventListener('click', function (e) {
      e.preventDefault();
      addRow(null);
    });

    editor.addEventListener('click', function (e) {
      var del = e.target.closest('.social-del');
      if (!del) return;
      var row = del.closest('.social-row');
      if (row) row.remove();
      if (!editor.querySelector('.social-row')) addRow(null);
    });

    editor.addEventListener('change', function (e) {
      if (e.target.matches('select.social-type')) syncAll();
    });

    editor.addEventListener('input', function (e) {
      if (e.target.matches('.social-url')) syncRow(e.target.closest('.social-row'));
    });

    var form = editor.closest('form');
    if (form) {
      form.addEventListener('submit', function () {
        hidden.value = JSON.stringify(collect());
        // 空状态提示（占位元素）由 CSS 处理，这里只保证隐藏域始终有值
        if (!hidden.value) hidden.value = '[]';
      });
    }

    // 首次同步（图标、placeholder、自定义下拉选项）
    syncAll();

    // 页面顶部提示：当前没有任何社交链接时不额外弹窗，保持安静
    void emptyText;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
