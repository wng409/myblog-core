/**
 * static-search.js —— 静态站（SSG）文章列表页交互
 *
 * 生效条件：仅当 <body data-static="true">（静态站）且页面存在 .posts-layout（posts.html）。
 *
 * 职责（接管 list.ejs 列表页的全部前端交互）：
 *   1. 侧边栏筛选面板开合 + 标签折叠（静态站不加载 posts.js，故一并接管）
 *   2. 搜索（input 防抖 + Enter + 按钮）、标签筛选、排序、分页 —— 纯前端
 *   3. URL 同步（history.pushState / replaceState）与浏览器前进后退（popstate）
 *
 * 数据来源：/api/posts.json（导出时生成，含 slug/title/tags/author_name/created_at/content_excerpt）
 * 卡片封面：api 不含 cover_image，从首屏服务端渲染的卡片 DOM 中提取 slug→封面 映射，避免重渲染丢封面。
 *
 * 约束：不改动服务端渲染的 DOM 结构（仅按需重渲染列表区），不涉及其它页面。
 */
(function () {
  'use strict';

  // ============================================================
  // 生效条件
  // ============================================================
  if (!document.body || document.body.getAttribute('data-static') !== 'true') return;
  var ROOT = document.querySelector('.posts-layout');
  var MAIN = ROOT && ROOT.querySelector('.posts-main');
  var SIDEBAR = ROOT && ROOT.querySelector('.posts-sidebar');
  if (!ROOT || !MAIN) return;

  // ============================================================
  // 常量与状态
  // ============================================================
  var PAGE_SIZE = 6;
  var API_URL = '/api/posts.json';
  var SORT_DEFAULT = 'desc';

  var state = { tag: '', search: '', sort: SORT_DEFAULT, page: 1 };
  var allPosts = [];   // 全量数据缓存
  var loaded = false;  // 是否已拉取
  var coverMap = {};   // slug -> 封面地址（由首屏 DOM 提取）

  // 页面文案（i18n）：由 list.ejs 输出的 .ssg-i18n 元素携带，避免在 JS 中硬编码文案
  var I18N = { emptyTitle: '', emptyHint: '', prevPage: '', nextPage: '' };
  function collectI18n() {
    var el = document.querySelector('.ssg-i18n');
    if (!el) return;
    I18N.emptyTitle = el.getAttribute('data-empty-title') || '';
    I18N.emptyHint = el.getAttribute('data-empty-hint') || '';
    I18N.prevPage = el.getAttribute('data-prev-page') || '';
    I18N.nextPage = el.getAttribute('data-next-page') || '';
  }

  // ============================================================
  // 工具
  // ============================================================
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 与 list.ejs 服务端渲染保持一致：取 created_at 前 10 位，避免前端时区漂移
  function fmtDate(s) {
    return String(s || '').slice(0, 10);
  }

  function parseHref(href) {
    try { return new URL(href, window.location.origin); } catch (e) { return null; }
  }

  // ============================================================
  // URL <-> state
  // ============================================================
  function readStateFromUrl() {
    var p = new URLSearchParams(window.location.search);
    state.tag = p.get('tag') || '';
    state.search = p.get('search') || '';
    state.sort = p.get('sort') === 'asc' ? 'asc' : SORT_DEFAULT;
    var n = parseInt(p.get('page'), 10);
    state.page = (n && n > 0) ? n : 1;
  }

  function buildUrl(st) {
    var p = new URLSearchParams();
    if (st.tag) p.set('tag', st.tag);
    if (st.search) p.set('search', st.search);
    if (st.sort !== SORT_DEFAULT) p.set('sort', st.sort);
    if (st.page > 1) p.set('page', String(st.page));
    var q = p.toString();
    return window.location.pathname + (q ? '?' + q : '');
  }

  // 是否处于默认态（无任何筛选参数）——默认态保持服务端渲染结果，不做重渲染
  function isDefaultState(st) {
    return !st.tag && !st.search && st.sort === SORT_DEFAULT && st.page <= 1;
  }

  function applyUrl(st, replace) {
    var url = buildUrl(st);
    if (replace) window.history.replaceState({ ssg: true }, '', url);
    else window.history.pushState({ ssg: true }, '', url);
  }

  // ============================================================
  // 数据
  // ============================================================
  function ensureData(callback) {
    if (loaded) { callback(); return; }
    fetch(API_URL, { credentials: 'same-origin' })
      .then(function (res) { return res.json(); })
      .then(function (json) {
        allPosts = (json && Array.isArray(json.posts)) ? json.posts : [];
        loaded = true;
        callback();
      })
      .catch(function () {
        loaded = true;
        allPosts = [];
        callback();
      });
  }

  // 从首屏（服务端渲染）卡片提取 slug -> 封面，保证重渲染时封面不丢
  function collectCoverMap() {
    var cards = MAIN.querySelectorAll('.posts-grid a.post-card');
    Array.prototype.forEach.call(cards, function (card) {
      var href = card.getAttribute('href') || '';
      var m = href.match(/^\/posts\/(.+)\.html$/);
      if (!m) return;
      var img = card.querySelector('.post-card-cover img');
      if (img) coverMap[m[1]] = img.getAttribute('src');
    });
  }

  // ============================================================
  // 过滤 / 排序 / 分页（纯逻辑）
  // ============================================================
  function selectPosts() {
    var tag = state.tag;
    var kw = state.search.trim().toLowerCase();

    var list = allPosts.filter(function (post) {
      if (tag) {
        var tags = String(post.tags || '').split(',').map(function (t) { return t.trim(); });
        if (tags.indexOf(tag) === -1) return false;
      }
      if (kw) {
        var hay = (String(post.title || '') + ' ' + String(post.content_excerpt || '')).toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });

    list.sort(function (a, b) {
      var da = String(a.created_at || '');
      var db = String(b.created_at || '');
      if (da === db) return 0;
      if (state.sort === 'asc') return da < db ? -1 : 1;
      return da > db ? -1 : 1;
    });

    var total = list.length;
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    var start = (state.page - 1) * PAGE_SIZE;
    return { items: list.slice(start, start + PAGE_SIZE), total: total, totalPages: totalPages };
  }

  // ============================================================
  // 渲染
  // ============================================================
  function cardHtml(post) {
    var slug = String(post.slug || '');
    var href = '/posts/' + encodeURIComponent(slug) + '.html';
    var cover = coverMap[slug] || '';
    var coverHtml = cover
      ? '<div class="post-card-cover"><img src="' + esc(cover) + '" alt="" loading="lazy"></div>'
      : '<div class="post-card-cover"><div class="post-card-placeholder"><i class="fas fa-file-alt"></i></div></div>';

    var tagHtml = '';
    var tags = String(post.tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 3);
    tags.forEach(function (t) {
      tagHtml += '<span class="post-card-tag">' + esc(t) + '</span>';
    });

    return '<a href="' + esc(href) + '" class="post-card">' +
      coverHtml +
      '<div class="post-card-body">' +
        '<h2 class="post-card-title">' + esc(post.title) + '</h2>' +
        '<div class="post-card-meta">' +
          '<div class="post-card-meta-left">' +
            '<time class="post-card-date">' + esc(fmtDate(post.created_at)) + '</time>' +
          '</div>' +
          '<div class="post-card-tags">' + tagHtml + '</div>' +
        '</div>' +
      '</div>' +
    '</a>';
  }

  function getGrid() {
    var grid = MAIN.querySelector('.posts-grid');
    if (!grid) {
      var noResults = MAIN.querySelector('.no-results');
      if (noResults) noResults.parentNode.removeChild(noResults);
      grid = document.createElement('div');
      grid.className = 'posts-grid';
      MAIN.insertBefore(grid, MAIN.firstChild);
    }
    return grid;
  }

  function renderCards(result) {
    var grid = getGrid();
    // 清掉旧的 no-results（若存在）
    var old = MAIN.querySelector('.no-results');
    if (old) old.parentNode.removeChild(old);

    if (result.items.length === 0) {
      grid.innerHTML = '';
      var empty = document.createElement('div');
      empty.className = 'no-results';
      empty.innerHTML = '<i class="fas fa-search"></i><h3>' + I18N.emptyTitle + '</h3><p>' + I18N.emptyHint + '</p>';
      grid.parentNode.insertBefore(empty, grid.nextSibling);
      return;
    }

    var html = '';
    result.items.forEach(function (p) { html += cardHtml(p); });
    grid.innerHTML = html;
  }

  function renderPagination(totalPages) {
    var old = MAIN.querySelector('.pagination-wrap');
    if (old) old.parentNode.removeChild(old);
    if (totalPages <= 1) return; // 与静态首屏一致：只有 1 页时不显示分页器

    var ul = '<ul class="pagination">';
    if (state.page > 1) {
      ul += '<li><a href="?page=' + (state.page - 1) + '" class="page-btn" data-page="' + (state.page - 1) + '"><i class="fas fa-chevron-left"></i> ' + I18N.prevPage + '</a></li>';
    } else {
      ul += '<li><span class="page-btn disabled"><i class="fas fa-chevron-left"></i> ' + I18N.prevPage + '</span></li>';
    }
    ul += '<li><span class="page-num active">' + state.page + ' / ' + totalPages + '</span></li>';
    if (state.page < totalPages) {
      ul += '<li><a href="?page=' + (state.page + 1) + '" class="page-btn" data-page="' + (state.page + 1) + '">' + I18N.nextPage + ' <i class="fas fa-chevron-right"></i></a></li>';
    } else {
      ul += '<li><span class="page-btn disabled">' + I18N.nextPage + ' <i class="fas fa-chevron-right"></i></span></li>';
    }
    ul += '</ul>';

    var wrap = document.createElement('div');
    wrap.className = 'pagination-wrap';
    wrap.style.marginTop = '30px';
    wrap.innerHTML = ul;
    MAIN.appendChild(wrap);
  }

  function updateChips() {
    // 标签 chips
    var chips = document.getElementById('tagChips');
    if (chips) {
      Array.prototype.forEach.call(chips.querySelectorAll('a.filter-chip'), function (a) {
        var url = parseHref(a.getAttribute('href'));
        var t = url ? (url.searchParams.get('tag') || '') : '';
        a.classList.toggle('active', t === state.tag);
      });
    }
    // 排序 chips
    var sortChips = ROOT.querySelectorAll('.posts-sidebar .filter-chips:not(#tagChips) a.filter-chip');
    Array.prototype.forEach.call(sortChips, function (a) {
      var url = parseHref(a.getAttribute('href'));
      var s = url ? (url.searchParams.get('sort') || SORT_DEFAULT) : SORT_DEFAULT;
      a.classList.toggle('active', s === state.sort);
    });
  }

  function render() {
    var result = selectPosts();
    renderCards(result);
    renderPagination(result.totalPages);
    updateChips();
    // 标题装饰用：非必要，不改动
  }

  // ============================================================
  // 导航（状态变更 -> URL -> 渲染）
  // ============================================================
  function navigate(patch, replace) {
    var next = {
      tag: state.tag,
      search: state.search,
      sort: state.sort,
      page: state.page
    };
    if ('tag' in patch) next.tag = patch.tag || '';
    if ('search' in patch) next.search = patch.search || '';
    if ('sort' in patch) next.sort = patch.sort || SORT_DEFAULT;
    if ('page' in patch) next.page = patch.page > 0 ? patch.page : 1;

    state = next;
    applyUrl(state, !!replace);
    ensureData(render);
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindSearch() {
    var input = document.getElementById('searchInput');
    var btn = document.getElementById('searchBtn');
    var timer = null;

    function doSearchNow() {
      navigate({ search: input ? input.value.trim() : '', page: 1 });
    }

    if (input) {
      input.addEventListener('input', function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(doSearchNow, 300); // 防抖
      });
      input.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doSearchNow(); }
      });
    }
    if (btn) {
      btn.addEventListener('click', function (e) { e.preventDefault(); doSearchNow(); });
    }
  }

  function bindChips() {
    if (!SIDEBAR) return;
    SIDEBAR.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a.filter-chip') : null;
      if (!a) return;
      var url = parseHref(a.getAttribute('href'));
      if (!url) return;
      e.preventDefault();

      if (a.closest('#tagChips')) {
        navigate({ tag: url.searchParams.get('tag') || '', page: 1 });
      } else if (url.searchParams.has('sort')) {
        navigate({ sort: url.searchParams.get('sort') || SORT_DEFAULT, page: 1 });
      }
    });
  }

  function bindPagination() {
    MAIN.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('.pagination-wrap a.page-btn') : null;
      if (!a) return;
      e.preventDefault();
      var p = parseInt(a.getAttribute('data-page'), 10);
      if (p > 0) navigate({ page: p });
    });
  }

  function bindSidebar() {
    // 侧边栏开合（原 posts.js 职责，静态站不加载 posts.js）
    var toggle = document.getElementById('filterToggle');
    var close = document.getElementById('filterClose');
    var panel = document.getElementById('filterPanel');
    var mask = document.getElementById('filterMask');

    function openPanel() {
      if (panel) panel.classList.add('open');
      if (mask) mask.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
    function closePanel() {
      if (panel) panel.classList.remove('open');
      if (mask) mask.classList.remove('show');
      document.body.style.overflow = '';
    }
    if (toggle) toggle.addEventListener('click', openPanel);
    if (close) close.addEventListener('click', closePanel);
    if (mask) mask.addEventListener('click', closePanel);

    // 标签折叠（原 posts.js 职责）
    var expandBtn = document.getElementById('tagExpand');
    var chips = document.getElementById('tagChips');
    if (expandBtn && chips) {
      expandBtn.addEventListener('click', function () {
        var expanded = chips.classList.toggle('expanded');
        expandBtn.innerHTML = expanded
          ? '收起 <i class="fas fa-chevron-up"></i>'
          : '显示全部 <i class="fas fa-chevron-down"></i>';
      });
    }
  }

  function bindPopstate() {
    window.addEventListener('popstate', function () {
      readStateFromUrl();
      ensureData(render);
    });
  }

  // ============================================================
  // 初始化
  // ============================================================
  function init() {
    readStateFromUrl();
    collectI18n();
    collectCoverMap();
    bindSearch();
    bindChips();
    bindPagination();
    bindSidebar();
    bindPopstate();

    // 首屏：默认态保持服务端渲染结果（不重渲染，零闪烁）；
    //       带参数则本地重渲染（先展示服务端内容，数据到达后替换）。
    if (!isDefaultState(state)) {
      ensureData(render);
    } else {
      ensureData(function () {}); // 预热数据，便于后续交互立即渲染
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();