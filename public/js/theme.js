// ==================== 主题切换（跟随系统 / 浅色 / 深色） ====================
(function () {
  var STORAGE_KEY = 'theme';
  var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function getTheme() {
    try {
      var t = localStorage.getItem(STORAGE_KEY);
      if (t === 'light' || t === 'dark') return t;
    } catch (e) { /* 存储不可用则回退到跟随系统 */ }
    return 'system';
  }

  function isDark(theme) {
    return theme === 'dark' || (theme === 'system' && !!mql && mql.matches);
  }

  function updateUI(theme) {
    var iconClass = theme === 'dark' ? 'fa-moon'
      : theme === 'light' ? 'fa-sun'
        : 'fa-circle-half-stroke';
    document.querySelectorAll('[data-theme-switch]').forEach(function (sw) {
      var icon = sw.querySelector('.theme-toggle-icon');
      if (icon) icon.className = 'theme-toggle-icon fas ' + iconClass;
      sw.querySelectorAll('.theme-menu button[data-theme-value]').forEach(function (btn) {
        var active = btn.getAttribute('data-theme-value') === theme;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
      });
    });
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle('dark', isDark(theme));
    document.documentElement.setAttribute('data-theme', theme);
    updateUI(theme);
  }

  function setTheme(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* 忽略存储异常 */ }
    applyTheme(theme);
  }

  function closeAll() {
    document.querySelectorAll('[data-theme-switch].open').forEach(function (sw) {
      sw.classList.remove('open');
      var btn = sw.querySelector('.theme-toggle');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function initTheme() {
    applyTheme(getTheme());

    document.querySelectorAll('[data-theme-switch]').forEach(function (sw) {
      var toggle = sw.querySelector('.theme-toggle');
      if (toggle) {
        toggle.addEventListener('click', function (e) {
          e.stopPropagation();
          var willOpen = !sw.classList.contains('open');
          closeAll();
          if (willOpen) {
            sw.classList.add('open');
            toggle.setAttribute('aria-expanded', 'true');
          }
        });
      }
      sw.querySelectorAll('.theme-menu button[data-theme-value]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          setTheme(btn.getAttribute('data-theme-value'));
          closeAll();
        });
      });
    });

    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });

    if (mql) {
      var onChange = function () { if (getTheme() === 'system') applyTheme('system'); };
      if (mql.addEventListener) mql.addEventListener('change', onChange);
      else if (mql.addListener) mql.addListener(onChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();