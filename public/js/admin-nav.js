// 后台导航：把「退出登录」与「主题切换」一起搬到页面右上角的 .header-actions 末尾
// （主题按钮必须在最右侧，且不能留在导航下方被遮挡）
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.querySelector('form.admin-logout');
    if (!form) return;

    var header = document.querySelector('.admin-header');
    if (header) {
      // 优先放进 .header-actions（标题右侧的按钮组），与「查看前台」并排
      var actions = header.querySelector('.header-actions');
      var holder = actions || header;

      // 1) 退出登录
      holder.appendChild(form);
      header.classList.add('has-logout');

      // 2) 主题切换：从 .admin-nav-tools 搬到按钮组末尾（最右）
      var tools = document.querySelector('.admin-nav-tools');
      var themeSwitch = tools && tools.querySelector('.theme-switch');
      if (themeSwitch) {
        holder.appendChild(themeSwitch);
        // 工具区搬空后隐藏，避免留下空白占位
        if (!tools.children.length) {
          tools.style.display = 'none';
        }
      }
    }
    form.hidden = false;                 // 没有 header 的页面退化为原地显示

    form.addEventListener('submit', function (e) {
      if (!window.confirm('确定要退出登录吗？')) e.preventDefault();
    });
  });
})();