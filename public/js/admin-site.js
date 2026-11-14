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