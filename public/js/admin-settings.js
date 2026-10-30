// 首页设置页交互：Banner 拖拽排序 / 移动端底部抽屉编辑 / 图片上传 / 推荐文章胶囊
(function () {
  'use strict';

  var CSRF_TOKEN = document.body.dataset.csrf || '';

  // ==================== 通用：提示 ====================
  function notify(msg) {
    if (window.toast && typeof window.toast.show === 'function') {
      window.toast.show(msg);
    } else if (window.showToast === 'function') {
      window.showToast(msg);
    } else {
      window.alert(msg);
    }
  }

  // ==================== Banner 列表 ====================
  function bannerRows() {
    var list = document.getElementById('bannerList');
    return list ? Array.prototype.slice.call(list.querySelectorAll('.banner-row')) : [];
  }

  function updateIndices() {
    bannerRows().forEach(function (row, i) {
      row.dataset.index = String(i);
      var titleInput = row.querySelector('input[name="title"]');
      var summary = row.querySelector('.banner-summary-title');
      var imgInput = row.querySelector('input[name="image"]');
      var thumb = row.querySelector('.banner-thumb');
      if (summary) {
        summary.textContent = (titleInput && titleInput.value.trim()) || '（未命名 Banner）';
      }
      if (thumb) {
        var url = imgInput ? imgInput.value.trim() : '';
        var img = thumb.querySelector('img');
        if (url) {
          if (!img) {
            img = document.createElement('img');
            img.alt = '';
            thumb.appendChild(img);
          }
          img.src = url;
        } else if (img) {
          img.remove();
        }
      }
    });

    // 抽屉打开时同步刷新大图预览（例如图片上传成功后地址被写入）
    if (sheet && sheet.classList.contains('open') && sheetBody) {
      var openFields = sheetBody.querySelector('.banner-fields');
      var preview = sheetBody.querySelector('.banner-preview');
      if (openFields && preview) renderPreview(openFields, preview);
    }
  }

  function collectBanners() {
    return bannerRows().map(function (row) {
      var postSel = row.querySelector('.banner-post');
      var titleIn = row.querySelector('input[name="title"]');
      var imgIn = row.querySelector('input[name="image"]');
      return {
        postId: (postSel && postSel.value) || null,
        title: titleIn ? titleIn.value.trim() : '',
        image: imgIn ? imgIn.value.trim() : ''
      };
    });
  }

  // 空状态提示：无 Banner 行时显示，避免列表区看起来"加载不出来"
  function updateEmptyTip() {
    var tip = document.getElementById('bannerEmptyTip');
    if (!tip) return;
    tip.style.display = bannerRows().length === 0 ? '' : 'none';
  }

  function addBanner() {
    var list = document.getElementById('bannerList');
    var tpl = document.getElementById('bannerRowTemplate');
    if (!list || !tpl) return;
    list.appendChild(tpl.content.cloneNode(true));
    updateIndices();
    updateEmptyTip();

    var rows = bannerRows();
    var last = rows[rows.length - 1];
    if (last && !last.dataset.dragBound) {
      bindDrag(last);
      last.dataset.dragBound = '1';
    }
  }

  function removeBanner(row) {
    if (row) row.remove();
    updateIndices();
    updateEmptyTip();
  }

  // ---------- 拖拽排序（PC） ----------
  var dragRow = null;

  function bindDrag(row) {
    row.dataset.dragBound = '1';
    row.addEventListener('dragstart', function (e) {
      dragRow = row;
      row.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', function () {
      row.classList.remove('dragging');
      dragRow = null;
      updateIndices();
    });
    row.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (dragRow && dragRow !== row) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', function () {
      row.classList.remove('drag-over');
    });
    row.addEventListener('drop', function (e) {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (!dragRow || dragRow === row) return;
      var list = document.getElementById('bannerList');
      var rows = bannerRows();
      if (rows.indexOf(dragRow) < rows.indexOf(row)) {
        list.insertBefore(dragRow, row.nextSibling);
      } else {
        list.insertBefore(dragRow, row);
      }
      updateIndices();
    });

    // 触摸端拖拽（HTML5 DnD 在触摸设备不可用）：长按手柄 300ms 后开始拖拽排序
    var handle = row.querySelector('.drag-handle');
    if (handle && !handle.dataset.touchBound) {
      handle.dataset.touchBound = '1';
      var pressTimer = null;
      var touching = false;
      var startY = 0;

      handle.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse') return;   // 鼠标走 HTML5 DnD
        startY = e.clientY;
        pressTimer = setTimeout(function () {
          touching = true;
          row.classList.add('dragging');
          if (handle.setPointerCapture) {
            try { handle.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
          }
        }, 300);
      });

      handle.addEventListener('pointermove', function (e) {
        if (!touching) {
          if (Math.abs(e.clientY - startY) > 10) clearTimeout(pressTimer);
          return;
        }
        e.preventDefault();
        var under = document.elementFromPoint(e.clientX, e.clientY);
        var target = under ? under.closest('.banner-row') : null;
        if (target && target !== row) {
          var list = document.getElementById('bannerList');
          var rows = bannerRows();
          if (rows.indexOf(row) < rows.indexOf(target)) list.insertBefore(row, target.nextSibling);
          else list.insertBefore(row, target);
          updateIndices();
        }
      });

      function endTouch() {
        clearTimeout(pressTimer);
        if (touching) {
          touching = false;
          row.classList.remove('dragging');
          updateIndices();
        }
      }
      handle.addEventListener('pointerup', endTouch);
      handle.addEventListener('pointercancel', endTouch);
      handle.addEventListener('contextmenu', function (e) { if (touching) e.preventDefault(); });
    }
  }

  // ---------- 移动端抽屉：把该行的 .banner-fields 移入抽屉 ----------
  var sheet = document.getElementById('bannerSheet');
  var sheetBody = document.getElementById('bannerSheetBody');
  var sheetMask = document.getElementById('bannerSheetMask');
  var sheetHost = null;   // 当前被移出字段的行

  // 抽屉内的大图预览：随图片地址变化实时刷新
  function renderPreview(fields, preview) {
    if (!preview) return;
    var imgIn = fields.querySelector('input[name="image"]');
    var url = imgIn ? imgIn.value.trim() : '';
    if (url) {
      preview.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      preview.textContent = '';
    } else {
      preview.style.backgroundImage = '';
      preview.textContent = '暂无图片预览';
    }
  }

  function openSheet(row) {
    if (!sheet || !sheetBody) return;
    var fields = row.querySelector('.banner-fields');
    if (!fields) return;
    sheetHost = row;

    // 打开抽屉时锁定页面滚动，避免误触背景
    document.body.style.overflow = 'hidden';

    // 预览块固定放在字段之前
    var preview = sheetBody.querySelector('.banner-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'banner-preview';
      sheetBody.appendChild(preview);
    }
    renderPreview(fields, preview);

    // 手动输入/粘贴图片地址时，预览实时跟随
    var imgIn = fields.querySelector('input[name="image"]');
    if (imgIn) imgIn.oninput = function () { renderPreview(fields, preview); };

    sheetBody.appendChild(fields);   // DOM 移动，保证表单字段仍属于原 form
    sheet.classList.add('open');
    if (sheetMask) sheetMask.classList.add('show');
  }

  function closeSheet() {
    if (sheetHost) {
      var fields = sheetBody.querySelector('.banner-fields');
      if (fields) {
        var imgIn = fields.querySelector('input[name="image"]');
        if (imgIn) imgIn.oninput = null;
        // 移回原行：插到删除按钮之前
        var removeBtn = sheetHost.querySelector('.banner-remove');
        if (removeBtn) sheetHost.insertBefore(fields, removeBtn);
        else sheetHost.appendChild(fields);
      }
      var preview = sheetBody.querySelector('.banner-preview');
      if (preview) preview.remove();
      sheetHost = null;
    }
    if (sheet) sheet.classList.remove('open');
    if (sheetMask) sheetMask.classList.remove('show');
    document.body.style.overflow = '';   // 解除滚动锁定
    updateIndices();
  }

  // 抽屉底部的「取消 / 保存」（移动端）
  (function bindSheetButtons() {
    var cancelBtn = document.getElementById('bannerSheetCancel');
    var saveBtn = document.getElementById('bannerSheetSave');
    if (cancelBtn) cancelBtn.addEventListener('click', closeSheet);
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        closeSheet();   // 先把字段移回原行，再收集
        var hidden = document.getElementById('bannerItemsInput');
        if (hidden) hidden.value = JSON.stringify(collectBanners());
        var form = document.getElementById('bannerForm');
        if (form) form.submit();
      });
    }
  })();

  // ---------- 事件委托 ----------
  document.addEventListener('click', function (e) {
    var addBtn = e.target.closest('#addBannerBtn');
    if (addBtn) { e.preventDefault(); addBanner(); return; }

    var removeBtn = e.target.closest('.banner-remove');
    if (removeBtn) {
      e.preventDefault();
      removeBanner(removeBtn.closest('.banner-row'));
      return;
    }

    var closeBtn = e.target.closest('#bannerSheetClose');
    if (closeBtn) { e.preventDefault(); closeSheet(); return; }
    if (e.target.closest('#bannerSheetMask')) { closeSheet(); return; }

    var summary = e.target.closest('.banner-summary');
    if (summary) {
      e.preventDefault();
      var row = summary.closest('.banner-row');
      if (row) openSheet(row);
      return;
    }
  });

  // 输入变化时同步移动端摘要
  document.addEventListener('input', function (e) {
    if (e.target.matches('.banner-fields input[name="title"], .banner-fields input[name="image"]')) {
      updateIndices();
    }
  });

  // ---------- 图片上传（点击输入框右侧的链接图标触发，动态行也生效） ----------
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.img-link-btn');
    if (!btn) return;
    e.preventDefault();

    var wrap = btn.closest('.img-input-wrap');
    var input = wrap ? wrap.querySelector('input[name="image"]') : null;
    if (!input) return;

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
    fileInput.className = 'hidden';

    fileInput.addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) { fileInput.remove(); return; }

      btn.disabled = true;
      btn.classList.add('is-uploading');

      var fd = new FormData();
      fd.append('image', file);
      fd.append('_csrf', CSRF_TOKEN);

      fetch('/admin/upload/image', {
        method: 'POST',
        headers: { 'x-csrf-token': CSRF_TOKEN },
        body: fd
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data.url) throw new Error(data.error || '返回数据异常');
          input.value = data.url;
          input.classList.add('input-ok');
          setTimeout(function () { input.classList.remove('input-ok'); }, 1500);
          updateIndices();
          notify('图片上传成功');
        })
        .catch(function (err) {
          notify('上传失败：' + err.message);
        })
        .then(function () {
          btn.disabled = false;
          btn.classList.remove('is-uploading');
          fileInput.remove();
        });
    });

    document.body.appendChild(fileInput);
    fileInput.click();
  });

  // ==================== 推荐文章胶囊 ====================
  var featuredIds = [];
  var chipsBox = document.getElementById('featuredChips');
  var candidatesBox = document.getElementById('featuredCandidates');
  var seedInput = document.getElementById('featuredIdsSeed');

  function renderChips() {
    if (!chipsBox) return;
    chipsBox.innerHTML = '';
    featuredIds.forEach(function (id) {
      var title = '';
      var cand = candidatesBox
        ? candidatesBox.querySelector('.candidate-chip[data-id="' + id + '"]')
        : null;
      if (cand) title = cand.dataset.title || '';

      var chip = document.createElement('span');
      chip.className = 'chip';

      var text = document.createElement('span');
      text.textContent = title || ('#' + id);
      chip.appendChild(text);

      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'chip-remove';
      rm.setAttribute('data-id', String(id));
      rm.setAttribute('aria-label', '移除');
      rm.innerHTML = '<i class="fas fa-times"></i>';
      chip.appendChild(rm);

      chipsBox.appendChild(chip);
    });
  }

  function addFeatured(id) {
    var n = parseInt(id, 10);
    if (!n || featuredIds.indexOf(n) !== -1) return;
    featuredIds.push(n);
    renderChips();
  }

  function removeFeatured(id) {
    var n = parseInt(id, 10);
    featuredIds = featuredIds.filter(function (x) { return x !== n; });
    renderChips();
  }

  if (candidatesBox) {
    candidatesBox.addEventListener('click', function (e) {
      var chip = e.target.closest('.candidate-chip');
      if (!chip) return;
      addFeatured(chip.dataset.id);
    });
  }

  if (chipsBox) {
    chipsBox.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip-remove');
      if (!btn) return;
      removeFeatured(btn.dataset.id);
    });
  }

  // 搜索过滤候选
  var searchInput = document.getElementById('featuredSearch');
  if (searchInput && candidatesBox) {
    searchInput.addEventListener('input', function () {
      var kw = this.value.trim().toLowerCase();
      Array.prototype.forEach.call(candidatesBox.querySelectorAll('.candidate-chip'), function (chip) {
        var t = (chip.dataset.title || '').toLowerCase();
        chip.classList.toggle('hidden', !!kw && t.indexOf(kw) === -1);
      });
    });
  }

  // ==================== 初始化 ====================
  document.addEventListener('DOMContentLoaded', function () {
    // 已有 Banner 行绑定拖拽
    bannerRows().forEach(bindDrag);
    updateIndices();
    updateEmptyTip();

    // 恢复已选推荐文章
    if (seedInput) {
      try {
        var seed = JSON.parse(seedInput.value || '[]');
        if (Array.isArray(seed)) seed.forEach(function (x) { addFeatured(x); });
      } catch (e) { /* 忽略解析异常 */ }
      seedInput.remove();   // 避免该字段被提交
    }

    // Banner 表单提交：收集数据写入隐藏域
    var bannerForm = document.getElementById('bannerForm');
    if (bannerForm) {
      bannerForm.addEventListener('submit', function () {
        closeSheet();   // 若抽屉打开，先把字段移回原行
        var hidden = document.getElementById('bannerItemsInput');
        if (hidden) hidden.value = JSON.stringify(collectBanners());
      });
    }

    // 推荐文章表单提交：写入 featuredIds（并按需同步 Banner）
    var featuredForm = document.getElementById('featuredForm');
    if (featuredForm) {
      featuredForm.addEventListener('submit', function () {
        // 若移动端抽屉正开着，先把 Banner 字段移回原行，否则会收集到空值
        closeSheet();

        var hidden = document.getElementById('featuredIdsInput');
        if (hidden) hidden.value = JSON.stringify(featuredIds);

        // 仅当页面确实渲染出 Banner 行时才同步 Banner；
        // 页面一行都没有（旧标签页 / 列表未加载）时禁用该字段，让后端保持库中原值，
        // 避免"保存推荐文章"把已有 Banner 清空。
        var bannerHidden = document.getElementById('bannerItemsInput2');
        if (bannerHidden) {
          if (bannerRows().length > 0) {
            bannerHidden.value = JSON.stringify(collectBanners());
          } else {
            bannerHidden.disabled = true;
          }
        }
      });
    }
  });

  // ==================== 站点设置：主题色取色器 / 文本值联动 ====================
  // 取色器（name=theme_color）是唯一可提交字段；文本框仅作展示与手动输入同步，
  // 避免用户往文本框粘贴色值后「保存了却没生效」。
  (function initThemeColorSync() {
    var colorInput = document.getElementById('themeColorInput');
    var textInput = document.getElementById('themeColorText');
    if (!colorInput || !textInput) return;

    var HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

    function expand(hex) {
      // #abc -> #aabbcc，取色器只接受 6 位
      if (hex.length === 4) {
        return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      }
      return hex;
    }

    colorInput.addEventListener('input', function () {
      textInput.value = colorInput.value;
    });

    textInput.addEventListener('input', function () {
      var v = textInput.value.trim();
      if (!HEX_RE.test(v)) return;
      colorInput.value = expand(v);
    });

    // 失焦时把非法输入回滚为当前生效色值，并同步取色器
    textInput.addEventListener('blur', function () {
      var v = textInput.value.trim();
      if (!HEX_RE.test(v)) {
        textInput.value = colorInput.value;
        return;
      }
      colorInput.value = expand(v);
      textInput.value = colorInput.value;
    });
  })();
})();