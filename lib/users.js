const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const i18n = require('./i18n');

// ==================== 密码哈希 ====================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(test, 'hex')
    );
  } catch (e) {
    return false;
  }
}

// ==================== 数据库初始化 ====================
function initUserTables(db) {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      target TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at DESC)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id)`);
  });
}

// ==================== 用户 CRUD ====================
function findUserByUsername(db, username, callback) {
  db.get('SELECT * FROM users WHERE username = ?', [username], callback);
}

function findUserById(db, id, callback) {
  db.get('SELECT * FROM users WHERE id = ?', [id], callback);
}

function createUser(db, { username, password, role }, callback) {
  const hash = hashPassword(password);
  db.run(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    [username, hash, role],
    function (err) { callback(err, this ? this.lastID : null); }
  );
}

function updateUsername(db, id, username, callback) {
  db.run('UPDATE users SET username = ? WHERE id = ?', [username, id], callback);
}

function updatePassword(db, id, newPassword, callback) {
  const hash = hashPassword(newPassword);
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id], callback);
}

function updateLastLogin(db, id, callback) {
  db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [id], callback);
}

// ==================== 日志 ====================
function writeLog(db, { userId, username, action, target, ip, userAgent }) {
  db.run(
    `INSERT INTO logs (user_id, username, action, target, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId || null, username || null, action, target || null, ip || null, userAgent || null]
  );
}

// 从请求对象生成日志中间件
function makeLogger(db) {
  return function logAction(req, action, target) {
    const user = req.session && req.session.user ? req.session.user : {};
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
              || req.socket.remoteAddress
              || '';
    writeLog(db, {
      userId: user.id,
      username: user.username,
      action,
      target,
      ip,
      userAgent: req.headers['user-agent'] || ''
    });
  };
}

// ==================== 统一错误页（风格对齐登录页）====================
function errorPage({ status = 500, title = '', message = '', backUrl = '/', backText = '', lang = 'zh' }) {
  const tr = (k) => i18n.t(lang, k);
  if (!title) title = tr('error.defaultTitle');
  if (!message) message = tr('error.defaultMsg');
  if (!backText) backText = tr('error.backHome');
  const subtitle = tr('error.subtitle');
  const backHome = tr('error.backHome');
  const htmlLang = lang === 'en' ? 'en' : 'zh-CN';
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(status)} · ${esc(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f5f5f5;
      padding: 20px;
      color: #1f2329;
      -webkit-font-smoothing: antialiased;
    }
    .error-box {
      background: #fff;
      padding: 40px 36px;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(230,0,18,0.08), 0 2px 8px rgba(0,0,0,0.04);
      width: 100%;
      max-width: 400px;
      border: 1px solid rgba(230,0,18,0.06);
      text-align: center;
    }
    .error-code {
      font-size: 3rem;
      font-weight: 700;
      color: #e60012;
      line-height: 1;
      margin-bottom: 8px;
      letter-spacing: 0.02em;
    }
    .error-title {
      font-size: 1.4rem;
      font-weight: 700;
      color: #e60012;
      margin: 0 0 8px;
    }
    .error-subtitle {
      color: #8f959e;
      font-size: 0.88rem;
      margin-bottom: 28px;
      line-height: 1.5;
    }
    .error-message {
      color: #4a5058;
      font-size: 0.95rem;
      line-height: 1.6;
      margin: 20px 0 24px;
      padding: 14px 16px;
      background: #fafbfc;
      border-radius: 8px;
      border: 1px solid #f0f0f0;
      word-break: break-word;
    }
    .error-btn {
      display: block;
      width: 100%;
      padding: 13px;
      border-radius: 8px;
      font-size: 1rem;
      font-family: inherit;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      margin-bottom: 10px;
    }
    .error-btn:last-child { margin-bottom: 0; }
    .error-btn-primary {
      background: #e60012;
      color: #fff;
    }
    .error-btn-primary:hover { background: #c4000f; }
    .error-btn-secondary {
      background: transparent;
      color: #8f959e;
      font-size: 0.9rem;
      padding: 10px;
    }
    .error-btn-secondary:hover { color: #e60012; }

    @media (max-width: 480px) {
      .error-box { padding: 32px 22px; border-radius: 14px; }
      .error-code { font-size: 2.4rem; }
      .error-title { font-size: 1.2rem; }
      .error-subtitle { font-size: 0.82rem; margin-bottom: 22px; }
      .error-message { font-size: 0.9rem; margin: 16px 0 20px; }
      .error-btn { padding: 12px; font-size: 0.95rem; }
    }
  </style>
</head>
<body>
  <div class="error-box">
    <div class="error-code">${esc(status)}</div>
    <h1 class="error-title">${esc(title)}</h1>
    <p class="error-subtitle">${esc(subtitle)}</p>
    <div class="error-message">${esc(message)}</div>
    <a href="${esc(backUrl)}" class="error-btn error-btn-primary">${esc(backText)}</a>
    ${backUrl !== '/' ? '<a href="/" class="error-btn error-btn-secondary">' + esc(backHome) + '</a>' : ''}
  </div>
</body>
</html>`;
}

// ==================== 导出 ====================
module.exports = {
  hashPassword,
  verifyPassword,
  initUserTables,
  findUserByUsername,
  findUserById,
  createUser,
  updateUsername,
  updatePassword,
  updateLastLogin,
  writeLog,
  makeLogger,
  errorPage
};