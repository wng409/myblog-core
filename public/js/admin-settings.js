// 从 body 上读 CSRF token
const CSRF_TOKEN = document.body.dataset.csrf || '';

// ==================== Banner 管理 ====================
function collectBanners() {
  const rows = document.querySelectorAll('#bannerList tr');
  const items = [];
  rows.forEach(row => {
    const postId = row.querySelector('.banner-post').value;
    const title = row.querySelector('input[name="title"]').value.trim();
    const image = row.querySelector('input[name="image"]').value.trim();
    items.push({ postId: postId || null, title, image });
  });
  return items;
}

function addBanner() {
  const tbody = document.getElementById('bannerList');
  const tpl = document.getElementById('bannerRowTemplate');
  if (!tbody || !tpl) return;
  const clone = tpl.content.cloneNode(true);
  tbody.appendChild(clone);
  updateIndices();
}

function removeBanner(index) {
  const rows = document.querySelectorAll('#bannerList tr');
  if (rows[index]) rows[index].remove();
  updateIndices();
}

function moveBannerUp(index) {
  const rows = document.querySelectorAll('#bannerList tr');
  if (index > 0) {
    const parent = rows[index].parentNode;
    parent.insertBefore(rows[index], rows[index - 1]);
    updateIndices();
  }
}

function moveBannerDown(index) {
  const rows = document.querySelectorAll('#bannerList tr');
  if (index < rows.length - 1) {
    const parent = rows[index].parentNode;
    parent.insertBefore(rows[index + 1], rows[index]);
    updateIndices();
  }
}

function updateIndices() {
  const rows = document.querySelectorAll('#bannerList tr');
  rows.forEach((row, i) => {
    row.dataset.index = i;
    const btns = row.querySelectorAll('button');
    btns.forEach(btn => {
      const action = btn.dataset.action;
      if (action === 'up') btn.onclick = function () { moveBannerUp(i); };
      else if (action === 'down') btn.onclick = function () { moveBannerDown(i); };
      else if (action === 'delete') btn.onclick = function () { removeBanner(i); };
    });
  });
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

  const bannerForm = document.getElementById('bannerForm');
  if (bannerForm) {
    bannerForm.addEventListener('submit', function () {
      const items = collectBanners();
      document.getElementById('bannerItemsInput').value = JSON.stringify(items);
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

  // 文件选择后即时预览（Dropzone 内的 .preview）
  function bindPreview(fileId, previewSelector) {
    var file = document.getElementById(fileId);
    var box = document.querySelector(previewSelector);
    if (!file || !box) return;
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var url = URL.createObjectURL(f);
      var img = box.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        box.textContent = '';
        box.appendChild(img);
      }
      img.src = url;
    });
  }
  bindPreview('siteLogoFile', '.settings-form .settings-block:nth-of-type(2) .modern-upload .preview');
  bindPreview('aboutAvatarFile', '.settings-form .settings-block:nth-of-type(3) .modern-upload .preview');
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

  function sync() {
    if (hidden) hidden.value = JSON.stringify(links);
    editor.querySelectorAll('.social-row').forEach(function (row, i) {
      row.querySelector('.social-type').value = TYPES.indexOf(links[i] && links[i].type) >= 0 ? links[i].type : 'link';
      row.querySelector('.social-url').value = (links[i] && links[i].url) || '';
    });
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
    if (removeText) del.textContent = removeText;
    if (data) { sel.value = data.type || 'link'; url.value = data.url || ''; }
    del.addEventListener('click', function () {
      var idx = Array.prototype.indexOf.call(editor.querySelectorAll('.social-row'), row);
      if (idx >= 0) { links.splice(idx, 1); row.remove(); sync(); }
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
