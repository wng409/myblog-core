document.addEventListener('DOMContentLoaded', function () {
  const box = document.querySelector('.login-box');
  const form = document.getElementById('loginForm');
  const btn = document.getElementById('loginBtn');
  const username = document.getElementById('usernameInput');
  const password = document.getElementById('passwordInput');

  // 有 error 时抖动
  if (box && document.querySelector('.error') && document.querySelector('.error').textContent.trim()) {
    box.classList.add('shake');
    setTimeout(() => box.classList.remove('shake'), 600);
    if (password) {
      password.value = '';
      password.focus();
    }
  }

  // 提交时按钮禁用
  if (form) {
    form.addEventListener('submit', function () {
      if (btn) {
        btn.disabled = true;
        btn.textContent = btn.dataset.loading || btn.textContent;
      }
    });
  }

  // 彩蛋：双击密码框 3 次
  if (password) {
    let egg = 0;
    password.addEventListener('dblclick', function () {
      egg++;
      if (egg === 3) {
        password.placeholder = '别敲了，密码不会自己出现 :)';
      }
    });
  }
});