// 上传图片到后端
async function uploadEditorImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  const csrf = document.body.dataset.csrf ||
               document.querySelector('input[name="_csrf"]')?.value || '';
  fd.append('_csrf', csrf);

  const res = await fetch('/admin/upload/image', {
    method: 'POST',
    body: fd
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data.url) throw new Error(data.error || '返回数据异常');
  return data.url;
}

document.addEventListener('DOMContentLoaded', function () {
  const textarea = document.getElementById('markdown-editor');
  if (!textarea || typeof EasyMDE === 'undefined') return;

  new EasyMDE({
    element: textarea,
    spellChecker: false,
    autoDownloadFontAwesome: false,   // 避免它再去 CDN 下载图标
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
              alert('图片上传失败：' + e.message);
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
});