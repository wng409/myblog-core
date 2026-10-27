// 从 body 上读 CSRF token
const CSRF_TOKEN = document.body.dataset.csrf || '';
const BANNER_UNTITLED = document.body.dataset.bannerUntitled || '';
const PREVIEW_EMPTY = document.body.dataset.bannerPreviewEmpty || '';

// ==================== Banner 管理 ====================
const sheet = document.getElementById('bannerSheet');
const sheetBody = document.getElementById('bannerSheetBody');
const sheetMask = document.getElementById('bannerSheetMask');
let sheetHost = null;

function bannerRows() {
  const list = document.getElementById('bannerList');
  return list ? Array.prototype.slice.call(list.querySelectorAll('.banner-row')) : [];
}

// 空状态提示：没有行时显示，避免列表区看起来"加载不出来"
function updateEmptyTip() {
  const tip = document.getElementById('bannerEmptyTip');
  if (!tip) return;
  tip.style.display = bannerRows().length === 0 ? '' : 'none';
}

// 抽屉内的大图预览
function renderPreview(fields, preview) {
  if (!preview) return;
  const imgIn = fields.querySelector('input[name="image"]');
  const url = imgIn ? imgIn.value.trim() : '';
  if (url) {
    preview.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
    preview.textContent = '';
  } else {
    preview.style.backgroundImage = '';
    preview.textContent = PREVIEW_EMPTY;
  }
}

function collectBanners() {
  return bannerRows().map(function (row) {
    const postSel = row.querySelector('.banner-post');
    const titleIn = row.querySelector('input[name="title"]');
    const imgIn = row.querySelector('input[name="image"]');
    return {
      postId: (postSel && postSel.value) || null,
      title: titleIn ? titleIn.value.trim() : '',
      image: imgIn ? imgIn.value.trim() : ''
    };
  });
}

// 序号 / 摘要 / 缩略图 / 按钮绑定
function updateIndices() {
  bannerRows().forEach(function (row, i) {
    row.dataset.index = String(i);

    const titleInput = row.querySelector('input[name="title"]');
    const summaryTitle = row.querySelector('.banner-summary-title');
    const imgInput = row.querySelector('input[name="image"]');
    const thumb = row.querySelector('.banner-thumb');

    if (summaryTitle) {
      summaryTitle.textContent = (titleInput && titleInput.value.trim()) || BANNER_UNTITLED;
    }
    if (thumb) {
      const url = imgInput ? imgInput.value.trim() : '';
      let img = thumb.querySelector('img');
      if (url) {
        if (!img) { img = document.createElement('img'); img.alt = ''; thumb.appendChild(img); }
        img.src = url;
      } else if (img) {
        img.remove();
      }
    }

    row.querySelectorAll('[data-action]').forEach(function (btn) {
      const action = btn.dataset.action;
      if (action === 'up') btn.onclick = function () { moveBannerUp(i); };
      else if (action === 'down') btn.onclick = function () { moveBannerDown(i); };
      else if (action === 'delete') btn.onclick = function () { removeBanner(i); };
    });
  });

  // 抽屉打开时同步刷新大图预览（手动输入 / 上传成功后都会走到这里）
  if (sheet && sheet.classList.contains('open') && sheetBody) {
    const openFields = sheetBody.querySelector('.banner-fields');
    const preview = sheetBody.querySelector('.banner-preview');
    if (openFields && preview) renderPreview(openFields, preview);
  }

  updateEmptyTip();
}

function addBanner() {
  const list = document.getElementById('bannerList');
  const tpl = document.getElementById('bannerRowTemplate');
  if (!list || !tpl) return;
  list.appendChild(tpl.content.cloneNode(true));
  updateIndices();
}

function removeBanner(index) {
  const rows = bannerRows();
  if (rows[index]) rows[index].remove();
  updateIndices();
}

function moveBannerUp(index) {
  const rows = bannerRows();
  if (index > 0 && rows[index]) {
    const parent = rows[index].parentNode;
    parent.insertBefore(rows[index], rows[index - 1]);
    updateIndices();
  }
}

function moveBannerDown(index) {
  const rows = bannerRows();
  if (index < rows.length - 1 && rows[index]) {
    const parent = rows[index].parentNode;
    parent.insertBefore(rows[index + 1], rows[index]);
    updateIndices();
  }
}

// ==================== 移动端：编辑抽屉 ====================
function openSheet(row) {
  if (!sheet || !sheetBody) return;
  const fields = row.querySelector('.banner-fields');
  if (!fields) return;
  sheetHost = row;

  // 预览块固定放在字段之前
  let preview = sheetBody.querySelector('.banner-preview');
  if (!preview) {
    preview = document.createElement('div');
    preview.className = 'banner-preview';
    sheetBody.appendChild(preview);
  }
  renderPreview(fields, preview);

  // 地址变化实时跟随
  const imgIn = fields.querySelector('input[name="image"]');
  if (imgIn) imgIn.oninput = function () { renderPreview(fields, preview); };

  sheetBody.appendChild(fields);   // DOM 移动，字段仍属于原 form
  sheet.classList.add('open');
  if (sheetMask) sheetMask.classList.add('show');
}

function closeSheet() {
  if (sheetHost) {
    const fields = sheetBody.querySelector('.banner-fields');
    if (fields) {
      const imgIn = fields.querySelector('input[name="image"]');
      if (imgIn) imgIn.oninput = null;
      // 移回原行：放在操作按钮之前
      const actions = sheetHost.querySelector('.banner-actions');
      if (actions) sheetHost.insertBefore(fields, actions);
      else sheetHost.appendChild(fields);
    }
    const preview = sheetBody.querySelector('.banner-preview');
    if (preview) preview.remove();
    sheetHost = null;
  }
  if (sheet) sheet.classList.remove('open');
  if (sheetMask) sheetMask.classList.remove('show');
  updateIndices();
}

// ==================== Banner 图片上传 ====================
document.addEventListener('click', function (e) {
  const btn = e.target.closest('.btn-upload');
  if (!btn) return;
  e.preventDefault();

  const input = btn.parentElement.querySelector('input[name="image"]');
  if (!input) return;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
  fileInput.style.display = 'none';

  fileInput.onchange = async function () {
    const file = this.files && this.files[0];
    if (!file) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = btn.dataset.loading || btn.textContent;

    const fd = new FormData();
    fd.append('image', file);
    fd.append('_csrf', CSRF_TOKEN);

    try {
      const res = await fetch('/admin/upload/image', {
        method: 'POST',
        headers: { 'x-csrf-token': CSRF_TOKEN },
        body: fd
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();
      if (data.url) {
        input.value = data.url;
        input.style.borderColor = '#10b981';
        input.style.boxShadow = '0 0 0 3px rgba(16,185,129,0.15)';
        setTimeout(() => {
          input.style.borderColor = '';
          input.style.boxShadow = '';
        }, 1500);
        updateIndices();   // 同步缩略图 + 抽屉内大图预览
      } else {
        throw new Error(data.error || document.body.dataset.uploadInvalid || 'Invalid response data');
      }
    } catch (err) {
      alert((document.body.dataset.uploadFailed || 'Upload failed: ') + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
      fileInput.remove();
    }
  };

  document.body.appendChild(fileInput);
  fileInput.click();
});

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', function () {
  updateIndices();

  const addBtn = document.getElementById('addBannerBtn');
  if (addBtn) addBtn.addEventListener('click', addBanner);

  // 移动端点击摘要 → 打开抽屉（事件委托，动态新增行同样生效）
  const listEl = document.getElementById('bannerList');
  if (listEl) {
    listEl.addEventListener('click', function (e) {
      const summary = e.target.closest('.banner-summary');
      if (!summary) return;
      const row = summary.closest('.banner-row');
      if (row) openSheet(row);
    });
  }
  if (sheetMask) sheetMask.addEventListener('click', closeSheet);
  const sheetClose = document.getElementById('bannerSheetClose');
  if (sheetClose) sheetClose.addEventListener('click', closeSheet);

  const bannerForm = document.getElementById('bannerForm');
  if (bannerForm) {
    bannerForm.addEventListener('submit', function () {
      closeSheet();   // 若抽屉开着，先把字段移回，保证能正确收集
      document.getElementById('bannerItemsInput').value = JSON.stringify(collectBanners());
    });
  }

  const featuredForm = document.getElementById('featuredForm');
  if (featuredForm) {
    featuredForm.addEventListener('submit', function () {
      const select = document.getElementById('featuredSelect');
      const selected = Array.from(select.selectedOptions).map(opt => parseInt(opt.value));
      document.getElementById('featuredIdsInput').value = JSON.stringify(selected);
      const bannerItemsInput2 = document.getElementById('bannerItemsInput2');
      if (bannerItemsInput2) {
        bannerItemsInput2.value = JSON.stringify(collectBanners());
      }
    });
  }
});

// 站点设置：颜色组联动（色块 <-> 文本框 双向） + 上传即时预览
(function () {
  var input = document.getElementById('themeColorInput');
  var text  = document.getElementById('themeColorText');
  var box   = document.getElementById('themeColorBox');
  var hexOk = function (v) { return /^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v); };

  if (input && box) {
    box.style.background = input.value;
    input.addEventListener('input', function () {
      if (text) text.value = input.value;
      box.style.background = input.value;
    });
    if (text) {
      text.addEventListener('input', function () {
        var v = text.value.trim();
        if (hexOk(v)) { input.value = v; box.style.background = v; }
      });
    }
  }

  // 「选择图片」按钮 -> 触发对应 file input（替代被 CSP 拦截的 inline onclick）
  Array.prototype.forEach.call(document.querySelectorAll('[data-file-target]'), function (btn) {
    btn.addEventListener('click', function () {
      var inp = document.getElementById(btn.getAttribute('data-file-target'));
      if (inp) inp.click();
    });
  });

  // 文件选择后：即时预览 + 显示文件名（替代被 CSP 拦截的 inline onchange）
  function bindUpload(fileId) {
    var file = document.getElementById(fileId);
    if (!file) return;
    var wrap = file.closest('.custom-upload');
    var box = wrap && wrap.querySelector('.preview-box');
    var nameEl = wrap && wrap.querySelector('.file-name');
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (nameEl) nameEl.textContent = f ? f.name : '';
      if (!f || !box) return;
      var img = box.querySelector('img');
      if (!img) {
        box.textContent = '';
        img = document.createElement('img');
        box.appendChild(img);
      }
      // 用 data: URL 预览（CSP img-src 允许 data:，blob: 会被拦截）
      var reader = new FileReader();
      reader.onload = function (ev) { img.src = ev.target.result; };
      reader.readAsDataURL(f);
    });
  }
  bindUpload('siteLogoFile');
  bindUpload('aboutAvatarFile');
})();

// 站点设置：社交链接动态列表（增删 + 同步到隐藏字段）
(function () {
  var editor = document.getElementById('socialEditor');
  if (!editor) return;
  var hidden = document.getElementById('socialLinksInput');
  var tpl = document.getElementById('socialRowTpl');
  var addBtn = document.getElementById('socialAddBtn');

  var TYPES = ['github', 'email', 'bilibili', 'zhihu', 'x', 'telegram', 'wechat', 'link'];
  var emptyText = editor.dataset.empty || '';
  var urlPh = editor.dataset.urlPh || '';
  var removeText = editor.dataset.remove || '';
  var customText = editor.dataset.custom || '';

  var links = [];
  try { links = JSON.parse(editor.dataset.links || '[]'); } catch (e) { links = []; }
  if (!Array.isArray(links)) links = [];

  // 从 DOM 收集当前值写回 links / 隐藏域（用户输入不再被回滚）
  function sync() {
    links = Array.prototype.map.call(editor.querySelectorAll('.social-row'), function (row) {
      var type = row.querySelector('.social-type').value;
      return {
        type: TYPES.indexOf(type) >= 0 ? type : 'link',
        url: (row.querySelector('.social-url').value || '').trim()
      };
    });
    if (hidden) hidden.value = JSON.stringify(links);
  }

  function addRow(data) {
    var node = tpl.content.cloneNode(true);
    var row = node.querySelector('.social-row');
    var sel = node.querySelector('.social-type');
    var url = node.querySelector('.social-url');
    var del = node.querySelector('.social-del');
    // 自定义链接选项文案
    var customOpt = sel.querySelector('option[value="link"]');
    if (customOpt) customOpt.textContent = customText || 'link';
    if (urlPh) url.placeholder = urlPh;
    if (data) { sel.value = data.type || 'link'; url.value = data.url || ''; }
    // 平台图标随 select 变化
    var iconEl = node.querySelector('.social-icon');
    var ICONS = { github:'fab fa-github', email:'fas fa-envelope', bilibili:'fab fa-bilibili', zhihu:'fab fa-zhihu', x:'fab fa-x-twitter', telegram:'fab fa-telegram', wechat:'fab fa-weixin', link:'fas fa-link' };
    function updIcon() { if (iconEl) iconEl.className = 'social-icon ' + (ICONS[sel.value] || 'fas fa-link'); }
    updIcon();
    sel.addEventListener('change', updIcon);
    del.addEventListener('click', function () {
      row.remove();
      sync();
    });
    sel.addEventListener('change', sync);
    url.addEventListener('input', sync);
    editor.appendChild(node);
  }

  // 初始渲染已有链接
  links.forEach(function (it) { addRow(it); });
  sync();

  if (addBtn) addBtn.addEventListener('click', function () {
    addRow({ type: 'github', url: '' });
    sync();
  });
})();
