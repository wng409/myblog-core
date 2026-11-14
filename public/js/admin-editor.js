// 文章编辑器：图片上传 / 折叠面板 / Tagify 标签 / EasyMDE
async function uploadEditorImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  const csrf = document.body.dataset.csrf ||
               (document.querySelector('input[name="_csrf"]') || {}).value || '';
  fd.append('_csrf', csrf);

  const res = await fetch('/admin/upload/image', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrf },
    body: fd
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data.url) throw new Error(data.error || '返回数据异常');
  return data.url;
}

document.addEventListener('DOMContentLoaded', function () {
  initFoldables();
  initTagify();
  initEasyMDE();
});

function initFoldables() {
  const slugToggle = document.getElementById('slugToggle');
  const slugWrapper = document.getElementById('slugWrapper');
  if (slugToggle && slugWrapper) {
    slugToggle.addEventListener('click', function () {
      slugWrapper.classList.toggle('show');
      if (slugWrapper.classList.contains('show')) {
        const input = slugWrapper.querySelector('input');
        if (input) input.focus();
      }
    });
  }

  const biliToggle = document.getElementById('biliToggle');
  const biliContent = document.getElementById('biliContent');
  if (biliToggle && biliContent) {
    const flip = function () {
      biliToggle.classList.toggle('active');
      biliContent.classList.toggle('show');
    };
    biliToggle.addEventListener('click', flip);
    biliToggle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        flip();
      }
    });
  }
}

function initTagify() {
  const input = document.getElementById('tagInput');
  if (!input || typeof Tagify === 'undefined') return;

  let data = { postTags: [], allTags: [] };
  const dataEl = document.getElementById('tag-data');
  if (dataEl) {
    try {
      data = JSON.parse(dataEl.textContent);
    } catch (e) {
      console.error('[tagify] tag-data 解析失败', e);
    }
  }

  new Tagify(input, {
    whitelist: data.allTags || [],
    maxTags: 8,
    duplicates: false,
    trim: true,
    delimiters: /[,，、;；\s]+/,
    originalInputValueFormat: function (valuesArr) {
      return valuesArr.map(function (v) { return v.value; }).join(',');
    },
    dropdown: {
      maxItems: 20,
      classname: 'ed-tagify-suggest',
      enabled: 1,
      closeOnSelect: true
    }
  });
}

function initEasyMDE() {
  const textarea = document.getElementById('markdown-editor');
  if (!textarea || typeof EasyMDE === 'undefined') return;

  const form = textarea.closest('form');

  const easyMDE = new EasyMDE({
    element: textarea,
    spellChecker: false,
    autoDownloadFontAwesome: false,
    autoFocus: true,
    toolbar: [
      'bold', 'italic', 'heading', '|',
      'quote', 'code', 'unordered-list', 'ordered-list', '|',
      'link',
      {
        name: 'upload-local-image',
        action: function (editor) {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/jpeg,image/png,image/gif,image/webp';
          input.onchange = async () => {
            if (!input.files[0]) return;
            try {
              const url = await uploadEditorImage(input.files[0]);
              const cm = editor.codemirror;
              const pos = cm.getCursor();
              cm.replaceRange(`![图片](${url})`, pos);
            } catch (e) {
              const msg = (document.body.dataset.msgUploadFailed || '图片上传失败：') + e.message;
              if (typeof window.hmAlert === 'function') {
                window.hmAlert(msg, '', { tone: 'danger' });
              } else {
                window.alert(msg);
              }
            }
          };
          input.click();
        },
        className: 'fa fa-image',
        title: '上传图片'
      },
      '|', 'preview', 'side-by-side', 'fullscreen'
    ]
  });

  if (form) {
    form.addEventListener('submit', function (e) {
      if (form.dataset.hmConfirmed === '1') return;

      const titleInput = form.querySelector('input[name="title"]');
      const titleVal = titleInput ? titleInput.value.trim() : '';
      const bodyVal = easyMDE.value().trim();

      if (!titleVal) {
        e.preventDefault();
        if (titleInput) titleInput.focus();
        const msg = document.body.dataset.msgTitleRequired || '标题不能为空，写个标题再保存。';
        if (typeof window.hmAlert === 'function') {
          window.hmAlert(msg, '', { tone: 'caution' });
        } else {
          window.alert(msg);
        }
        return;
      }

      if (!bodyVal) {
        e.preventDefault();
        easyMDE.codemirror.focus();
        const msg = document.body.dataset.msgBodyRequired || '正文不能为空，写点内容再保存。';
        if (typeof window.hmAlert === 'function') {
          window.hmAlert(msg, '', { tone: 'caution' });
        } else {
          window.alert(msg);
        }
      }
    });
  }
}