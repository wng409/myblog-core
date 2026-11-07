// 后台侧边栏：PC 折叠 / 移动端抽屉 / 退出确认
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var sidebar = document.getElementById('adminSidebar');
    if (!sidebar) return;

    var mask = document.getElementById('adminSidebarMask');
    var collapseBtn = document.getElementById('adminCollapseBtn');
    var header = document.querySelector('.admin-header');
    var confirmLogoutText = sidebar.getAttribute('data-confirm-logout') || '';
    var collapseLabel = sidebar.getAttribute('data-collapse-label') || '';
    var expandLabel = sidebar.getAttribute('data-expand-label') || '';
    var openMenuLabel = sidebar.getAttribute('data-open-menu') || '';

    function isMobile() {
      return window.matchMedia('(max-width: 768px)').matches;
    }

    function updateCollapseLabel() {
      if (!collapseBtn) return;
      var label = sidebar.classList.contains('collapsed') ? expandLabel : collapseLabel;
      collapseBtn.setAttribute('title', label);
      collapseBtn.setAttribute('aria-label', label);
    }
    updateCollapseLabel();

    if (collapseBtn) {
      collapseBtn.addEventListener('click', function () {
        var collapsed = sidebar.classList.toggle('collapsed');
        document.cookie = 'admin_sidebar_collapsed=' + (collapsed ? '1' : '0') +
          '; Path=/; Max-Age=31536000; SameSite=Lax';
        updateCollapseLabel();
      });
    }

    var toggle = document.getElementById('adminSidebarToggle');
    if (!toggle && header) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.id = 'adminSidebarToggle';
      toggle.className = 'admin-mobile-toggle';
      toggle.setAttribute('aria-label', openMenuLabel);
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<i class="fas fa-bars"></i>';
      header.insertBefore(toggle, header.firstChild);
    }

    function openDrawer() {
      sidebar.classList.add('mobile-open');
      if (mask) mask.classList.add('show');
      document.body.style.overflow = 'hidden';
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }

    function closeDrawer() {
      sidebar.classList.remove('mobile-open');
      if (mask) mask.classList.remove('show');
      document.body.style.overflow = '';
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    if (toggle) toggle.addEventListener('click', openDrawer);
    if (mask) mask.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });

    window.addEventListener('resize', function () {
      if (!isMobile()) closeDrawer();
    });

    sidebar.querySelectorAll('.admin-nav-item').forEach(function (link) {
      link.addEventListener('click', function () {
        if (isMobile()) closeDrawer();
      });
    });

    var logoutForm = document.querySelector('.admin-sidebar-logout');
    if (logoutForm) {
      logoutForm.addEventListener('submit', function (e) {
        if (confirmLogoutText && !window.confirm(confirmLogoutText)) e.preventDefault();
      });
    }
  });
})();