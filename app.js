require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const MarkdownIt = require('markdown-it');
const md = new MarkdownIt({ html: false, linkify: true });
const expressLayouts = require('express-ejs-layouts');
const users = require('./lib/users');
const { normalizeTags, parseTags, escapeLike } = require('./lib/tags');
// 用于时间侧信道防御的假哈希：启动时计算一次即可，
// 绝不能放进路由内每次生成（一次 scrypt 约 50ms，会造成 CPU DoS）
const DUMMY_PASSWORD_HASH = users.hashPassword('dummy_password_for_timing_protection');
const i18n = require('./lib/i18n');
let currentLang = i18n.DEFAULT_LANG;

const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

if (!process.env.SESSION_SECRET) {
  console.error('错误：请在 .env 文件中设置 SESSION_SECRET（至少32位随机字符串）');
  console.error('提示：可用命令生成 -> openssl rand -base64 32');
  process.exit(1);
}

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Markdown 渲染缓存（避免每次访问 /posts/:slug 都全量解析）
const mdCache = new Map();
const MD_CACHE_MAX = 100;

function renderMarkdownCached(content, updated_at, slug) {
  const cacheKey = `${slug}_${updated_at}`;
  if (mdCache.has(cacheKey)) {
    return mdCache.get(cacheKey);
  }
  const html = DOMPurify.sanitize(md.render(content || ''));
  if (mdCache.size >= MD_CACHE_MAX) {
    // 移除最早插入的一条
    const firstKey = mdCache.keys().next().value;
    mdCache.delete(firstKey);
  }
  mdCache.set(cacheKey, html);
  return html;
}

// 列表/首页摘要：去掉 Markdown 标记与 HTML 标签，压缩空白后截断（默认 150 字）
function toExcerpt(raw, max) {
  const limit = max || 150;
  const text = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

// 自动创建运行时目录，保证开箱即用（与 Dockerfile 预创建列表保持一致）
['db', 'sessions', 'public/uploads', 'public/_tmp'].forEach((dir) => {
  try { fs.mkdirSync(path.join(ROOT_DIR, dir), { recursive: true }); } catch (e) {}
});

// 默认不信任任何代理头：直连部署时伪造 X-Forwarded-For 无效，限流与日志才可信。
// 反代部署（Nginx / Cloudflare Tunnel）时在 .env 里设置 TRUST_PROXY=1（或实际跳数）。
const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
  app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
}

// ============================================================
// 数据库初始化
// ============================================================
const db = new sqlite3.Database(path.join(ROOT_DIR, 'db/database.sqlite'));

db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA busy_timeout = 5000;');

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    slug TEXT UNIQUE,
    content TEXT,
    tags TEXT,
    cover_image TEXT,
    bilibili_embed TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id=1),
    banner_images TEXT DEFAULT '[]',
    featured_post_ids TEXT DEFAULT '[]'
  )`);
  db.run(`INSERT OR IGNORE INTO settings (id, banner_images, featured_post_ids) VALUES (1, '[]', '[]')`);

  db.run(`ALTER TABLE settings ADD COLUMN site_lang TEXT DEFAULT 'zh'`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) {
      console.error('[迁移失败] site_lang:', err.message);
    }
  });

  // 站点个性化设置字段（幂等迁移）
  [
    ['site_title', "TEXT DEFAULT ''"],
    ['site_subtitle', "TEXT DEFAULT ''"],
    ['theme_color', "TEXT DEFAULT '#e60012'"],
    ['about_bio', "TEXT DEFAULT ''"],
    ['footer_text', "TEXT DEFAULT ''"],
    ['site_logo', "TEXT DEFAULT ''"],
    ['footer_subtitle', "TEXT DEFAULT ''"],
    ['about_avatar', "TEXT DEFAULT ''"],
    ['about_github', "TEXT DEFAULT ''"],
    ['about_email', "TEXT DEFAULT ''"],
    ['about_name', "TEXT DEFAULT ''"],
    ['about_title', "TEXT DEFAULT ''"],
    ['about_text', "TEXT DEFAULT ''"],
    ['about_tech', "TEXT DEFAULT ''"],
    ['about_history', "TEXT DEFAULT '[]'"],
    ['social_links', "TEXT DEFAULT '[]'"]
  ].forEach(([col, def]) => {
    db.run(`ALTER TABLE settings ADD COLUMN ${col} ${def}`, (err) => {
      if (err && !/duplicate column/i.test(err.message)) {
        console.error(`[迁移失败] settings.${col}:`, err.message);
      }
    });
  });

  db.run(`ALTER TABLE posts ADD COLUMN deleted_at DATETIME`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) {
      console.error('[迁移失败] deleted_at:', err.message);
    }
  });
});

users.initUserTables(db);

// 站点个性化设置（启动加载；后台保存后调用 loadSiteSettings 刷新）
let siteSettings = {};
function loadSiteSettings(cb) {
  db.get('SELECT site_lang, site_title, site_subtitle, theme_color, about_bio, about_github, about_email, about_name, about_title, about_text, about_tech, about_history, social_links, footer_text, footer_subtitle, site_logo, about_avatar FROM settings WHERE id = 1', (err, row) => {
    siteSettings = row || {};
    // social_links 解析为数组供模板遍历（存储仍为 JSON 字符串）
    siteSettings.social_links = safeParseJson(siteSettings.social_links);
    if (!err && row && i18n.LANGS.includes(row.site_lang)) {
      currentLang = row.site_lang;
    }
    if (cb) cb();
  });
}
loadSiteSettings();

db.get('SELECT COUNT(*) AS c FROM users', (err, row) => {
  if (err) { console.error('用户表检查失败:', err); return; }
  if (row.c === 0) {
    const defaultUser = process.env.ADMIN_USERNAME || 'admin';
    const generated = crypto.randomBytes(9).toString('base64url');
    const defaultPass = process.env.ADMIN_PASSWORD || generated;
    users.createUser(db, {
      username: defaultUser, password: defaultPass
    }, (err) => {
      if (err) { console.error('创建默认管理员失败:', err); return; }
      console.log(`[OK] 已创建默认管理员账号：${defaultUser}`);
      if (!process.env.ADMIN_PASSWORD) {
        console.log(`[!!] 随机初始密码：${defaultPass}`);
        console.log('     请登录后台后立刻在「我的资料」中修改密码！');
      }
    });
  }
});

const logAction = users.makeLogger(db);

// 安全 JSON 解析（防止 settings 表字段损坏导致全站崩溃）
function safeParseJson(str, fallback = []) {
  if (!str) return fallback;
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    console.error('[safeParseJson] JSON 解析失败，使用 fallback:', e.message);
    return fallback;
  }
}

// ============================================================
// 孤儿图片清理
// ============================================================
const ORPHAN_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function extractUploadRefs(text) {
  const refs = new Set();
  if (!text) return refs;
  const m = String(text).match(/\/uploads\/[^\s)"'<>]+/g);
  if (!m) return refs;
  m.forEach(raw => {
    let u = raw.split('?')[0].split('#')[0];
    u = u.replace(/[，。、；：！？（）【】《》「」‘’“”…—,.;:!?()[\]{}]+$/g, '');
    if (u.includes('..')) return;
    if (u && u.startsWith('/uploads/')) refs.add(u);
  });
  return refs;
}

function extractRefs(cover, content) {
  const refs = new Set();
  if (cover && cover.startsWith('/uploads/')) refs.add(cover);
  if (content) extractUploadRefs(content).forEach(u => refs.add(u));
  return refs;
}

function isImageReferencedByOthers(ref, excludeId, callback) {
  db.get(
    `SELECT COUNT(*) AS c FROM posts
     WHERE id != ? AND (cover_image = ? OR content LIKE ?)`,
    [excludeId, ref, `%${ref}%`],
    (err, row) => {
      if (err) return callback(true);
      if (row && row.c > 0) return callback(true);

      // 站点设置里的 Banner / Logo / 头像同样是「正在展示」的图，不能删
      db.get(
        `SELECT banner_images, site_logo, about_avatar FROM settings WHERE id = 1`,
        (e2, s) => {
          if (e2 || !s) return callback(false);
          const refs = new Set();
          if (typeof s.site_logo === 'string' && s.site_logo) refs.add(s.site_logo);
          if (typeof s.about_avatar === 'string' && s.about_avatar) refs.add(s.about_avatar);
          try {
            const arr = JSON.parse(s.banner_images || '[]');
            if (Array.isArray(arr)) {
              arr.forEach((item) => {
                if (typeof item === 'string') refs.add(item);
                else if (item && typeof item.image === 'string') refs.add(item.image);
              });
            }
          } catch (e) { /* 旧数据损坏时忽略 */ }
          callback(refs.has(ref));
        }
      );
    }
  );
}

function deleteRemovedImages(oldPost, newCover, newContent, req) {
  if (!oldPost) return;
  const oldRefs = extractRefs(oldPost.cover_image, oldPost.content);
  const newRefs = extractRefs(newCover, newContent);
  const removed = [...oldRefs].filter(r => !newRefs.has(r));

  removed.forEach(ref => {
    if (!ref.startsWith('/uploads/')) return;
    if (ref.includes('..')) return;
    const full = path.resolve(PUBLIC_DIR, '.' + ref);
    if (!full.startsWith(UPLOADS_DIR + path.sep)) return;
    isImageReferencedByOthers(ref, oldPost.id, (used) => {
      if (used) return;
      try {
        if (fs.existsSync(full)) {
          fs.unlinkSync(full);
          if (req) logAction(req, 'delete_image', ref);
        }
      } catch (e) {}
    });
  });
}

function collectReferencedImages(callback) {
  const refs = new Set();
  db.all(`SELECT cover_image FROM posts WHERE cover_image LIKE '/uploads/%'`, (e1, r1) => {
    (r1 || []).forEach(r => refs.add(r.cover_image));
    db.all(`SELECT content FROM posts`, (e2, r2) => {
      (r2 || []).forEach(r => extractUploadRefs(r.content).forEach(u => refs.add(u)));
      db.get(`SELECT banner_images, site_logo, about_avatar FROM settings WHERE id = 1`, (e3, r3) => {
        if (r3) {
          if (typeof r3.site_logo === 'string' && r3.site_logo) refs.add(r3.site_logo);
          if (typeof r3.about_avatar === 'string' && r3.about_avatar) refs.add(r3.about_avatar);
        }
        if (r3 && r3.banner_images) {
          try {
            const arr = JSON.parse(r3.banner_images);
            if (Array.isArray(arr)) {
              arr.forEach(item => {
                if (item && item.image && typeof item.image === 'string' &&
                    item.image.startsWith('/uploads/')) {
                  refs.add(item.image);
                }
              });
            }
          } catch (e) {}
        }
        callback(refs);
      });
    });
  });
}

function purgeOrphanUploads(triggeredBy, callback, options) {
  const dryRun = !!(options && options.dryRun);
  if (!fs.existsSync(UPLOADS_DIR)) {
    if (callback) callback({ deleted: 0, freedBytes: 0 });
    return;
  }
  collectReferencedImages(async (refs) => {
    const now = Date.now();
    let deleted = 0, freedBytes = 0;
    const files = [];

    // 异步遍历：不再 readdirSync/statSync 阻塞事件循环
    async function walk(dir) {
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
      catch (e) { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { await walk(full); continue; }
        let stat;
        try { stat = await fs.promises.stat(full); } catch (e) { continue; }
        if (now - stat.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
        files.push({ full, size: stat.size });
      }
    }
    await walk(UPLOADS_DIR);

    const candidates = [];
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      const rel = '/' + path.relative(PUBLIC_DIR, item.full).replace(/\\/g, '/');
      if (refs.has(rel)) continue;
      if (dryRun) { candidates.push(rel); continue; }
      try { await fs.promises.unlink(item.full); deleted++; freedBytes += item.size; } catch (e) {}
      if (i > 0 && i % 50 === 0) await new Promise((r) => setImmediate(r));
    }

    if (dryRun) {
      console.log(`[孤儿清理 dry-run] 候选 ${candidates.length} 个（触发：${triggeredBy}）`);
      if (callback) callback({ deleted: 0, freedBytes: 0, dryRun: true, candidates });
      return;
    }

    if (deleted > 0) {
      const mb = (freedBytes / 1024 / 1024).toFixed(2);
      console.log(`[孤儿清理] ${deleted} 个 / ${mb} MB（触发：${triggeredBy}）`);
    }
    if (callback) callback({ deleted, freedBytes, dryRun: false });
  });
}

// ============================================================
// 安全中间件
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'sha256-DWaw7tgyUAEY7i04xnzMvS34dxle5TZNqw5YFoLxMJY='"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", "https://player.bilibili.com", "https://www.bilibili.com"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"]
    }
  }
}));
app.disable('x-powered-by');

app.use(cookieParser());

app.use(session({
  store: new FileStore({
    path: path.join(ROOT_DIR, 'sessions'),
    ttl: 7 * 24 * 60 * 60,
    reapInterval: 24 * 60 * 60,
    retries: 0,
    logFn: () => {}
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = (req.session && req.session.user) || null;
  // 侧边栏折叠状态：由 cookie 在首屏直接渲染，避免导航后先展开再收起
  res.locals.adminSidebarCollapsed = (req.headers.cookie || '')
    .split(';')
    .map(function (part) { return part.trim(); })
    .some(function (part) { return part === 'admin_sidebar_collapsed=1'; });
  res.locals.lang = currentLang;
  res.locals.t = (key) => i18n.t(currentLang, key);
  res.locals.settings = siteSettings;
  // 社交链接：图标与显示名映射（模板遍历 social_links 时使用）
  res.locals.socialIcons = { github: 'fab fa-github', email: 'fas fa-envelope', bilibili: 'fab fa-bilibili', zhihu: 'fab fa-zhihu', x: 'fab fa-x-twitter', telegram: 'fab fa-telegram', wechat: 'fab fa-weixin', link: 'fas fa-link' };
  res.locals.socialLabels = { github: 'GitHub', email: 'Email', bilibili: 'Bilibili', zhihu: '知乎', x: 'X', telegram: 'Telegram', wechat: '微信', link: '' };
  next();
});

app.use((req, res, next) => {
  res.locals.LANGS = i18n.LANGS;
  res.locals.getLangLabel = i18n.getLangLabel;
  res.locals.DEFAULT_LANG = i18n.DEFAULT_LANG;
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/_tmp/')) return res.status(404).end();
  next();
});
app.use(express.static(PUBLIC_DIR));
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT_DIR, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/layout');
app.locals.siteName = process.env.SITE_NAME || 'MyBlog';

// ========== 时间格式化 ==========
app.locals.fmtTime = function (t) {
  if (!t) return '';
  let iso = String(t).trim();
  if (!iso.includes('T')) iso = iso.replace(' ', 'T');
  if (!/[Z+]/.test(iso)) iso += 'Z';
  const d = new Date(iso);
  if (isNaN(d)) return t;

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(d);

  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};

// ========== 登录限流 ==========
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress;
    users.writeLog(db, {
      userId: null,
      username: (req.body && req.body.username) || '(空)',
      action: 'login_rate_limited',
      target: 'admin',
      ip: clientIp,
      userAgent: req.headers['user-agent'] || ''
    });
    res.status(429).send(i18n.t(currentLang, 'auth.rateLimited'));
  }
});

// ========== CSRF ==========
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax'
  },
  value: (req) => {
    return req.headers['csrf-token'] ||
           req.headers['x-csrf-token'] ||
           (req.body && req.body._csrf) ||
           (req.query && req.query._csrf);
  }
});

// ========== 认证 ==========
const authOnly = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/admin/login');
  }
  users.findUserById(db, req.session.user.id, (err, user) => {
    if (err || !user || !user.is_active) {
      return req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/admin/login');
      });
    }
    // 密码已变更：其它设备上的会话立即失效（pwdTag 由 updatePassword 维护）
    if (user.pwd_tag && req.session.user.pwdTag !== user.pwd_tag) {
      return req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/admin/login');
      });
    }
    if (user.username !== req.session.user.username) {
      req.session.user.username = user.username;
    }
    next();
  });
};

const authAndCsrf = [authOnly, csrfProtection];

// 密码强度：>=10 位，且至少包含两类字符（小写/大写/数字/符号）
function passwordIssue(pwd) {
  if (typeof pwd !== 'string' || pwd.length < 10) return 'short';
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pwd)).length;
  if (kinds < 2) return 'weak';
  return '';
}

// 单用户模型：不再区分角色，所有登录用户即管理员（原 adminOnly 已移除）

// ========== XSS 清理 ==========
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return DOMPurify.sanitize(str.trim(), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
};

// URL 白名单：仅允许站内相对路径（/ 开头）或 https:// 绝对地址
// 同时拒绝引号 / 括号 / 反引号 / 空白 / 控制字符，避免在 CSS url() 或 HTML 属性中闭合逃逸
const UNSAFE_URL_CHARS = /[\u0000-\u001F\u007F"'`()\\\s]/;
const SAFE_REL_PATH = /^[\/\w\-.%?&=#~:@+\u4e00-\u9fa5]+$/;
const SAFE_HTTPS_URL = /^https:\/\/[\w\-.:\/@?&=#~%+\u4e00-\u9fa5]+$/i;
const sanitizeUrl = (url) => {
  if (typeof url !== 'string') return '';
  const s = url.trim();
  if (!s || UNSAFE_URL_CHARS.test(s)) return '';
  if (/^[\/\\]{2}/.test(s)) return '';   // 拒绝协议相对 URL（//、/\、\\、\/）
  if (s.startsWith('/')) return SAFE_REL_PATH.test(s) ? s : '';
  if (SAFE_HTTPS_URL.test(s)) return s;
  return '';
};

// 纯文本字段（标题 / 标签）：只去控制字符与零宽字符，保留 < > & 原文。
// 入库存原文，输出层由 EJS <%= %> 转义；若存储时就转成 &lt;，模板再转义会变成 &amp;lt;。
const sanitizePlainText = (str) => {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2028\u2029\uFEFF]/g, '');
};

// 只保留对象元素：防止 settings 中出现 [null] 导致首页 TypeError
function parseObjectArray(val) {
  return safeParseJson(val).filter((it) => it && typeof it === 'object' && !Array.isArray(it));
}

// 只保留正整数：featured_post_ids 这类 ID 数组用
function parseIdArray(val) {
  return safeParseJson(val).map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

// slug 规范化：只保留字母 / 数字 / 中文与连字符，避免 / ? # 破坏路由
function toSafeSlug(raw, fallbackTitle) {
  let s = String(raw || '').trim();
  if (!s) s = String(fallbackTitle || '').trim();
  s = s.normalize('NFKC').toLowerCase()
    .replace(/['"“”‘’]/g, '')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) s = 'post-' + Date.now().toString(36);
  return s.slice(0, 80);
}

// 全局清洗跳过名单：正文（Markdown 渲染时处理）、纯文本字段、
// 密码类字段（DOMPurify 会把 p@ss<w0rd 截成 p@ss，导致初始密码永久无法登录）
const SKIP_SANITIZE_KEYS = new Set([
  'content', 'title', 'tags',
  'password', 'oldPassword', 'newPassword', 'confirmPassword'
]);

app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    Object.keys(req.body).forEach(key => {
      if (SKIP_SANITIZE_KEYS.has(key)) return;
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    });
  }
  next();
});

// ========== 文件上传 ==========
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/gif':  '.gif',
  'image/webp': '.webp'
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeExt = MIME_TO_EXT[file.mimetype] || '.bin';
    const random = Math.random().toString(36).slice(2, 8);
    cb(null, Date.now() + '-' + random + safeExt);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 2, fields: 20, fieldSize: 1 * 1024 * 1024,   // 站点设置大表单需同时上传 Logo + 头像
    fieldNameSize: 100, parts: 25
  },
  fileFilter: (req, file, cb) => {
    const allowedMime = Object.keys(MIME_TO_EXT);
    const allowedExt  = Object.values(MIME_TO_EXT);
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMime.includes(file.mimetype) && allowedExt.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传 JPEG、PNG、GIF、WebP 图片'), false);
    }
  }
});

// 由上传文件的绝对路径生成可访问的 URL
function fileUrl(file) {
  return '/' + path.relative(PUBLIC_DIR, file.path).replace(/\\/g, '/');
}

// ========== 编辑器图片上传 ==========
app.post('/admin/upload/image', authOnly, csrfProtection, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: i18n.t(currentLang, 'admin.upload.err.noFile') });
  const url = fileUrl(req.file);
  logAction(req, 'upload_image', url);
  res.json({ url });
});

// ========== 工具函数 ==========
// 列表/卡片场景所需字段（不含正文 content，避免列表查询白读全文）
const POST_LIST_FIELDS = 'id, title, slug, tags, cover_image, bilibili_embed, created_at, updated_at';

const POSTS_PER_PAGE = 20;
// 后台列表分页：COUNT + LIMIT/OFFSET（原来是无 LIMIT 的全量查询）
const getPostsPage = (page, size, cb) => {
  const limit = Math.max(1, Number(size) || POSTS_PER_PAGE);
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
  db.get('SELECT COUNT(*) AS c FROM posts WHERE deleted_at IS NULL', (e0, row) => {
    const total = row ? row.c : 0;
    db.all(
      `SELECT ${POST_LIST_FIELDS} FROM posts WHERE deleted_at IS NULL
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
      (err, rows) => cb(err, rows || [], total, limit)
    );
  });
};
const getPostBySlug = (slug, cb) => db.get('SELECT * FROM posts WHERE slug = ? AND deleted_at IS NULL', [slug], cb);
const getPostById = (id, cb) => db.get('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL', [id], cb);
const getSetting = (cb) => db.get('SELECT * FROM settings WHERE id = 1', cb);
// 标签池缓存：60s 内复用；文章增删改后主动失效
let allTagsCache = { at: 0, data: null };
function invalidateAllTagsCache() { allTagsCache = { at: 0, data: null }; }
const getAllTags = (cb) => {
  if (allTagsCache.data && Date.now() - allTagsCache.at < 60000) {
    return cb(null, allTagsCache.data.slice());
  }
  db.all('SELECT tags FROM posts WHERE deleted_at IS NULL', (err, rows) => {
    if (err) return cb(err);
    const tagSet = new Set();
    rows.forEach(row => {
      parseTags(row.tags).forEach(t => tagSet.add(t));
    });
    const list = Array.from(tagSet);
    allTagsCache = { at: Date.now(), data: list };
    cb(null, list.slice());
  });
};
const getTrashPosts = (cb) => db.all(`SELECT ${POST_LIST_FIELDS}, deleted_at FROM posts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`, cb);
const getDeletedPostById = (id, cb) => db.get('SELECT * FROM posts WHERE id = ? AND deleted_at IS NOT NULL', [id], cb);
const countTrash = (cb) => db.get('SELECT COUNT(*) AS c FROM posts WHERE deleted_at IS NOT NULL', cb);

// ============================================================
// 前台路由
// ============================================================
app.get('/', (req, res) => {
  getSetting((err, setting) => {
    if (err) return res.status(500).send(users.errorPage({ status: 500, title: i18n.t(currentLang, 'error.500.title'), message: i18n.t(currentLang, 'error.500.message'), lang: currentLang }));
    const featuredIds = setting ? parseIdArray(setting.featured_post_ids) : [];
    const bannerItems = setting ? parseObjectArray(setting.banner_images) : [];

    const placeholders = featuredIds.map(() => '?').join(',');
    const sql = featuredIds.length > 0
      ? `SELECT ${POST_LIST_FIELDS} FROM posts WHERE id IN (${placeholders}) AND deleted_at IS NULL ORDER BY created_at DESC`
      : `SELECT ${POST_LIST_FIELDS} FROM posts WHERE 1=0`;

    db.all(sql, featuredIds, (err, featuredPosts) => {
      if (err) featuredPosts = [];
      db.all(`SELECT ${POST_LIST_FIELDS} FROM posts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 10`, (err, latestPosts) => {
        if (err) latestPosts = [];
        latestPosts.forEach(p => { p.tagList = parseTags(p.tags); });

        const finish = (bannerPosts) => {
          db.get('SELECT COUNT(*) AS total FROM posts WHERE deleted_at IS NULL', (err2, statRow) => {
            if (err2) statRow = { total: 0 };
            db.all('SELECT tags FROM posts WHERE deleted_at IS NULL', (err3, tagRows) => {
              const counter = new Map();
              (tagRows || []).forEach(row => {
                parseTags(row.tags).forEach(t => counter.set(t, (counter.get(t) || 0) + 1));
              });
              const tagStats = Array.from(counter, ([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

              res.render('index', {
                titleKey: 'nav.home',
                bannerPosts,
                featuredPosts,
                latestPosts,
                stats: { posts: statRow ? statRow.total : 0, tags: counter.size },
                tagStats,
                darkMode: (req.session && req.session.darkMode) || false
              });
            });
          });
        };

        let bannerPosts = [];
        if (bannerItems.length > 0) {
          const postIds = bannerItems.map(item => Number(item.postId)).filter(n => Number.isInteger(n) && n > 0);
          if (postIds.length > 0) {
            const placeholders2 = postIds.map(() => '?').join(',');
            db.all(`SELECT id, title, slug, cover_image FROM posts WHERE id IN (${placeholders2}) AND deleted_at IS NULL`, postIds, (err, posts) => {
              const postMap = {};
              (posts || []).forEach(p => postMap[p.id] = p);
              bannerItems.forEach(item => {
                const post = item.postId ? postMap[item.postId] : null;
                bannerPosts.push({
                  title: item.title || (post ? post.title : '默认标题'),
                  image: item.image || (post ? post.cover_image : ''),
                  slug: post ? post.slug : '#'
                });
              });
              finish(bannerPosts);
            });
          } else {
            bannerItems.forEach(item => {
              bannerPosts.push({ title: item.title || '默认标题', image: item.image || '', slug: '#' });
            });
            finish(bannerPosts);
          }
        } else {
          bannerPosts = latestPosts.slice(0, 5).map(p => ({
            title: p.title, image: p.cover_image || '', slug: p.slug
          }));
          finish(bannerPosts);
        }
      });
    });
  });
});

app.get('/posts', (req, res) => {
  const tag = normalizeTags(req.query.tag || '');
  const search = req.query.search || '';
  const sort = req.query.sort || 'desc';

  // 分页：每页 6 篇（与前台卡片网格 3 列 x 2 行一致）
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 6;
  const offset = (page - 1) * limit;

  let whereSql = ' WHERE deleted_at IS NULL';
  const params = [];
  if (tag) {
    // 边界匹配：',vue,' 不会误命中 ',vuepress,'
    whereSql += " AND (',' || tags || ',') LIKE ? ESCAPE '\\'";
    params.push(`%,${escapeLike(tag)},%`);
  }
  if (search) {
    // 转义 LIKE 通配符并限制长度，避免用户输入 % / _ 放大匹配范围
    const kw = `%${escapeLike(String(search).slice(0, 100))}%`;
    whereSql += " AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')";
    params.push(kw, kw);
  }

  // 1) 先查总数，算总页数
  db.get(`SELECT COUNT(*) AS total FROM posts${whereSql}`, params, (err, row) => {
    if (err) return res.status(500).send(users.errorPage({ status: 500, title: i18n.t(currentLang, 'error.500.title'), message: i18n.t(currentLang, 'error.500.message'), lang: currentLang }));
    const totalPages = Math.max(1, Math.ceil((row ? row.total : 0) / limit));

    // 2) 查当前页数据（LENGTH(content) 供阅读时长；substr 取前 400 字生成摘要，避免整篇正文）
    const sql = `SELECT p.id, p.title, p.slug, p.tags, p.cover_image, p.created_at, p.updated_at,
                        LENGTH(p.content) AS content_len, substr(p.content, 1, 400) AS excerpt
                 FROM posts p${whereSql}
                 ORDER BY p.created_at ${sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`;
    db.all(sql, [...params, limit, offset], (err, posts) => {
      if (err) return res.status(500).send(users.errorPage({ status: 500, title: i18n.t(currentLang, 'error.500.title'), message: i18n.t(currentLang, 'error.500.message'), lang: currentLang }));
      posts.forEach(p => {
        p.tagList = parseTags(p.tags);
        p.excerpt = toExcerpt(p.excerpt, 150);
      });
      getAllTags((err, tags) => {
        if (err) tags = [];
        res.render('posts/list', {
          titleKey: 'nav.posts', posts: posts || [], tags: tags || [],
          currentTag: tag, search, sort,
          darkMode: (req.session && req.session.darkMode) || false,
          currentPage: page, totalPages
        });
      });
    });
  });
});

app.get('/posts/:slug', (req, res) => {
  getPostBySlug(req.params.slug, (err, post) => {
    if (err || !post) return res.status(404).send(users.errorPage({ status: 404, title: i18n.t(currentLang, 'error.404.title'), message: i18n.t(currentLang, 'error.404.message'), lang: currentLang }));
    post.htmlContent = renderMarkdownCached(post.content, post.updated_at, post.slug);
    post.tagList = parseTags(post.tags);
    getAllTags((err, tags) => {
      if (err) tags = [];
      res.render('posts/detail', {
        title: post.title, post, tags,
        darkMode: (req.session && req.session.darkMode) || false
      });
    });
  });
});

// 关于我（独立页面，内容全部来自 settings，不含任何硬编码个人信息）
app.get('/about', (req, res) => {
  res.render('about', {
    titleKey: 'nav.about',
    about: {
      name: siteSettings.about_name || siteSettings.site_title || '',
      title: siteSettings.about_title || '',
      text: siteSettings.about_text || siteSettings.about_bio || '',
      tech: parseTags(siteSettings.about_tech || ''),
      history: safeParseJson(siteSettings.about_history || '[]'),
      avatar: siteSettings.about_avatar || '',
      email: siteSettings.about_email || '',
      social: siteSettings.social_links || []
    },
    darkMode: (req.session && req.session.darkMode) || false
  });
});

// ============================================================
// 登录与登出
// ============================================================
app.get('/admin/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  res.render('admin/login', { layout: false, error: null, csrfToken: null });
});

app.post('/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const clientIp = req.ip || req.socket.remoteAddress;
  const clientUA = req.headers['user-agent'] || '';

  const fail = (msg) => {
    users.writeLog(db, {
      userId: null,
      username: username || '(空)',
      action: 'login_fail',
      target: 'admin',
      ip: clientIp,
      userAgent: clientUA
    });
    res.status(401).render('admin/login', {
      layout: false, error: msg || i18n.t(currentLang, 'auth.invalid'), csrfToken: null
    });
  };

  if (!username || !password) return fail(i18n.t(currentLang, 'auth.empty'));

  users.findUserByUsername(db, username, (err, user) => {
    if (err) { console.error('查询用户失败:', err); return res.status(500).send(i18n.t(currentLang, 'error.500.title')); }
    if (!user) {
      // 防御时间侧信道：即使账号不存在，也执行一次等价的 scrypt 校验，
      // 拉平与"密码错误"分支的耗时，避免通过响应时间枚举有效用户名
      users.verifyPassword(password, DUMMY_PASSWORD_HASH);
      return fail(i18n.t(currentLang, 'auth.invalid'));
    }
    if (!user.is_active) return fail(i18n.t(currentLang, 'auth.disabled'));
    if (!users.verifyPassword(password, user.password_hash)) return fail(i18n.t(currentLang, 'auth.invalid'));

    req.session.regenerate((regenErr) => {
      if (regenErr) { console.error('Session regenerate error:', regenErr); return res.status(500).send(i18n.t(currentLang, 'auth.failed')); }
      req.session.user = {
        id: user.id,
        username: user.username,
        pwdTag: user.pwd_tag || null
      };

      users.updateLastLogin(db, user.id, () => {
        users.writeLog(db, {
          userId: user.id, username: user.username,
          action: 'login_success', target: 'admin',
          ip: clientIp, userAgent: clientUA
        });
      });

      req.session.save(saveErr => {
        if (saveErr) { console.error('Session save error:', saveErr); return res.status(500).send(i18n.t(currentLang, 'auth.failed')); }
        res.redirect('/admin');
      });
    });
  });
});

app.post('/admin/logout', authAndCsrf, (req, res) => {
  if (req.session.user) logAction(req, 'logout', 'admin');
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/admin/login');
  });
});

// ============================================================
// 我的资料
// ============================================================
app.get('/admin/profile', authOnly, csrfProtection, (req, res) => {
  users.findUserById(db, req.session.user.id, (err, user) => {
    if (err || !user) return res.status(404).send(i18n.t(currentLang, 'profile.userNotFound'));
    res.render('admin/profile', {
      layout: false, me: user,
      message: req.query.msg || null, error: req.query.err || null,
      csrfToken: req.csrfToken()
    });
  });
});

app.post('/admin/profile/username', authAndCsrf, (req, res) => {
  const newUsername = (req.body.username || '').trim();

  if (!/^[a-zA-Z0-9_\-\.]{2,32}$/.test(newUsername)) {
    return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.usernameFormat')));
  }
  users.findUserByUsername(db, newUsername, (err, exists) => {
    if (err) return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.serverError')));
    if (exists && exists.id !== req.session.user.id) {
      return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.usernameTaken')));
    }
    users.updateUsername(db, req.session.user.id, newUsername, (err) => {
      if (err) return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.updateFailed')));
      req.session.user.username = newUsername;
      logAction(req, 'update_username', `user:${req.session.user.id}`);
      req.session.save(() => res.redirect('/admin/profile?msg=' + encodeURIComponent(i18n.t(currentLang, 'profile.msg.usernameUpdated'))));
    });
  });
});

app.post('/admin/profile/password', authAndCsrf, (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body;
  if (!oldPassword || !newPassword || !confirmPassword) {
    return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.allFieldsRequired')));
  }
  const pwdIssue = passwordIssue(newPassword);
  if (pwdIssue === 'short') return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.passwordTooShort')));
  if (pwdIssue === 'weak') return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.passwordWeak')));
  if (newPassword !== confirmPassword) return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.passwordMismatch')));

  users.findUserById(db, req.session.user.id, (err, user) => {
    if (err || !user) return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.userNotFound')));
    if (!users.verifyPassword(oldPassword, user.password_hash)) {
      logAction(req, 'password_change_fail', `user:${user.id}`);
      return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.oldPasswordWrong')));
    }
    users.updatePassword(db, user.id, newPassword, (err) => {
      if (err) return res.redirect('/admin/profile?err=' + encodeURIComponent(i18n.t(currentLang, 'profile.err.updateFailed')));
      logAction(req, 'change_password', `user:${user.id}`);
      res.redirect('/admin/profile?msg=' + encodeURIComponent(i18n.t(currentLang, 'profile.msg.passwordChanged')));
    });
  });
});

// ============================================================
// 后台首页（文章管理）
// ============================================================
app.get('/admin', authOnly, csrfProtection, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  getPostsPage(page, POSTS_PER_PAGE, (err, posts, total, size) => {
    if (err) posts = [];
    const totalPages = Math.max(1, Math.ceil(total / size));
    countTrash((err2, row) => {
      res.render('admin/dashboard', {
        layout: false, posts, trashCount: row ? row.c : 0,
        page, totalPages, total,
        message: req.query.msg || null, error: req.query.err || null,
        csrfToken: req.csrfToken()
      });
    });
  });
});

// ============================================================
// 文章管理
// ============================================================
app.get('/admin/posts/new', authOnly, csrfProtection, (req, res) => {
  getAllTags((err, allTags) => {
    res.render('admin/posts/edit', {
      layout: false, post: null, action: '/admin/posts',
      error: req.query.err || null,
      csrfToken: req.csrfToken(), allTags: allTags || []
    });
  });
});

app.get('/admin/posts/edit/:id', authOnly, csrfProtection, (req, res) => {
  getPostById(req.params.id, (err, post) => {
    if (err || !post) return res.status(404).send(i18n.t(currentLang, 'posts.err.notFound'));
    post.tagList = parseTags(post.tags);
    getAllTags((err2, allTags) => {
      res.render('admin/posts/edit', {
        layout: false, post, action: `/admin/posts/${post.id}`,
        error: req.query.err || null,
        csrfToken: req.csrfToken(), allTags: allTags || []
      });
    });
  });
});

app.post('/admin/posts', authOnly, csrfProtection, upload.single('cover_image'), (req, res) => {
  // 标题保留原文（全局中间件已跳过 title）；其余字段已由全局清洗处理
  const title = sanitizePlainText(req.body.title || '');
  const { slug, content, tags, bilibili_embed, cover_image_url } = req.body;
  const finalSlug = toSafeSlug(slug, title);
  const now = new Date().toISOString();
  const safeBilibili = sanitizeUrl(bilibili_embed);
  const cleanTags = normalizeTags(tags);

  let cover_image = '';
  if (req.file) cover_image = fileUrl(req.file);
  else if (cover_image_url) cover_image = sanitizeUrl(cover_image_url);

  db.run(
    `INSERT INTO posts (title, slug, content, tags, cover_image, bilibili_embed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, finalSlug, content, cleanTags, cover_image, safeBilibili, now, now],
    function(err) {
      if (err) {
        console.error(err);
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.redirect('/admin/posts/new?err=' + encodeURIComponent(i18n.t(currentLang, 'posts.err.slugTaken')));
        }
        return res.status(500).send(i18n.t(currentLang, 'posts.err.saveFailed'));
      }
      invalidateAllTagsCache();
      logAction(req, 'create_post', `post:${this.lastID}`);
      res.redirect('/admin?msg=' + encodeURIComponent(i18n.t(currentLang, 'posts.msg.published')));
    }
  );
});

app.post('/admin/posts/:id', authOnly, csrfProtection, upload.single('cover_image'), (req, res) => {
  getPostById(req.params.id, (err, oldPost) => {
    if (err || !oldPost) return res.status(404).send(i18n.t(currentLang, 'posts.err.notFound'));

    // 标题保留原文（全局中间件已跳过 title）；其余字段已由全局清洗处理
    const title = sanitizePlainText(req.body.title || '');
    const { slug, content, tags, bilibili_embed, existing_cover, cover_image_url } = req.body;
    const finalSlug = toSafeSlug(slug, title);
    const now = new Date().toISOString();
    const safeBilibili = sanitizeUrl(bilibili_embed);
    const cleanTags = normalizeTags(tags);

    let newCover = sanitizeUrl(existing_cover);
    if (req.file) newCover = fileUrl(req.file);
    else if (cover_image_url) newCover = sanitizeUrl(cover_image_url);

    db.run(
      `UPDATE posts SET title=?, slug=?, content=?, tags=?, cover_image=?, bilibili_embed=?, updated_at=? WHERE id=? AND deleted_at IS NULL`,
      [title, finalSlug, content, cleanTags, newCover, safeBilibili, now, req.params.id],
      function(err) {
        if (err) {
          console.error(err);
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.redirect(`/admin/posts/edit/${req.params.id}?err=` + encodeURIComponent(i18n.t(currentLang, 'posts.err.slugTaken')));
          }
          return res.status(500).send(i18n.t(currentLang, 'posts.err.updateFailed'));
        }
        invalidateAllTagsCache();
      logAction(req, 'update_post', `post:${req.params.id}`);
        deleteRemovedImages(oldPost, newCover, content, req);
        res.redirect('/admin?msg=' + encodeURIComponent(i18n.t(currentLang, 'posts.msg.updated')));
      }
    );
  });
});

app.post('/admin/posts/delete/:id', authAndCsrf, (req, res) => {
  db.run(
    `UPDATE posts SET deleted_at = CURRENT_TIMESTAMP,
       slug = COALESCE(slug,'') || '__deleted_' || strftime('%s','now')
     WHERE id = ? AND deleted_at IS NULL`,
    [req.params.id],
    function (err) {
      if (err) return res.status(500).send(i18n.t(currentLang, 'posts.err.deleteFailed'));
      invalidateAllTagsCache();
      logAction(req, 'delete_post', `post:${req.params.id}`);
      res.redirect('/admin?msg=' + encodeURIComponent(i18n.t(currentLang, 'posts.msg.deleted')));
    }
  );
});

// ============================================================
// 回收站
// ============================================================
app.get('/admin/posts/trash', authOnly, csrfProtection, (req, res) => {
  getTrashPosts((err, posts) => {
    if (err) posts = [];
    res.render('admin/posts/trash', {
      layout: false, posts,
      message: req.query.msg || null, error: req.query.err || null,
      csrfToken: req.csrfToken()
    });
  });
});

app.post('/admin/posts/restore/:id', authAndCsrf, (req, res) => {
  getDeletedPostById(req.params.id, (err, post) => {
    if (err || !post) return res.redirect('/admin/posts/trash?err=' + encodeURIComponent(i18n.t(currentLang, 'posts.err.notFound')));
    const baseSlug = post.slug || '';
    const newSlug = baseSlug.replace(/__deleted_\d+$/, '') || ('post-' + post.id);
    db.run(
      'UPDATE posts SET deleted_at = NULL, slug = ? WHERE id = ?',
      [newSlug, req.params.id],
      function (err) {
        if (err) {
          db.run('UPDATE posts SET deleted_at = NULL WHERE id = ?', [req.params.id], (e2) => {
            if (e2) return res.redirect('/admin/posts/trash?err=' + encodeURIComponent(i18n.t(currentLang, 'posts.trash.err.restoreFailed')));
            invalidateAllTagsCache();
      logAction(req, 'restore_post', `post:${req.params.id}`);
            res.redirect('/admin/posts/trash?msg=' + encodeURIComponent(i18n.t(currentLang, 'posts.trash.msg.restoredWithSuffix')));
          });
          return;
        }
        logAction(req, 'restore_post', `post:${req.params.id}`);
        res.redirect('/admin/posts/trash?msg=' + encodeURIComponent(i18n.t(currentLang, 'posts.trash.msg.restored')));
      }
    );
  });
});

app.post('/admin/posts/purge/:id', authAndCsrf, (req, res) => {
  getDeletedPostById(req.params.id, (err, post) => {
    if (err || !post) return res.redirect('/admin/posts/trash?err=' + encodeURIComponent(i18n.t(currentLang, 'posts.err.notFound')));
    db.run('DELETE FROM posts WHERE id = ? AND deleted_at IS NOT NULL', [req.params.id], function (err) {
      if (err) return res.redirect('/admin/posts/trash?err=' + encodeURIComponent(i18n.t(currentLang, 'posts.trash.err.purgeFailed')));
      invalidateAllTagsCache();
      logAction(req, 'purge_post', `post:${post.id}`);
      deleteRemovedImages(post, '', '', req);
      res.redirect('/admin/posts/trash?msg=' + encodeURIComponent(i18n.t(currentLang, 'posts.trash.msg.purged')));
    });
  });
});

app.post('/admin/posts/trash/empty', authAndCsrf, (req, res) => {
  db.all('SELECT * FROM posts WHERE deleted_at IS NOT NULL', (err, posts) => {
    if (err) posts = [];
    db.run('DELETE FROM posts WHERE deleted_at IS NOT NULL', function (err) {
      if (err) return res.redirect('/admin/posts/trash?err=' + encodeURIComponent(i18n.t(currentLang, 'posts.trash.err.emptyFailed')));
      invalidateAllTagsCache();
      logAction(req, 'empty_trash', `posts`);
      posts.forEach(p => deleteRemovedImages(p, '', '', req));
      res.redirect('/admin/posts/trash?msg=' + encodeURIComponent(i18n.t(currentLang, 'posts.trash.msg.emptied')));
    });
  });
});

app.post('/admin/posts/trash/clean-orphans', authAndCsrf, (req, res) => {
  const dryRun = req.query.dryRun === '1';
  purgeOrphanUploads('manual', ({ deleted, freedBytes, dryRun: isDry, candidates }) => {
    if (isDry) {
      return res.json({ dryRun: true, count: candidates.length, files: candidates.slice(0, 200) });
    }
    const mb = (freedBytes / 1024 / 1024).toFixed(2);
    logAction(req, 'clean_orphan_images', `${deleted} files / ${mb} MB`);
    if (deleted === 0) {
      res.redirect('/admin/posts/trash?msg=' + encodeURIComponent(i18n.t(currentLang, 'posts.trash.msg.noOrphans')));
    } else {
      res.redirect('/admin/posts/trash?msg=' + encodeURIComponent(
        i18n.t(currentLang, 'posts.trash.msg.orphansCleanedPrefix') + deleted +
        i18n.t(currentLang, 'posts.trash.msg.orphansCleanedMid') + mb +
        i18n.t(currentLang, 'posts.trash.msg.orphansCleanedSuffix')
      ));
    }
  }, { dryRun });
});

// ============================================================
// 首页设置
// ============================================================
app.get('/admin/settings', authOnly, csrfProtection, (req, res) => {
  getSetting((err, setting) => {
    if (err) return res.status(500).send(i18n.t(currentLang, 'admin.settings.err.dbError'));
    const bannerRaw   = (setting && setting.banner_images) || '[]';
    const bannerItems = setting ? parseObjectArray(setting.banner_images) : [];
    const featuredIds = setting ? parseIdArray(setting.featured_post_ids) : [];
    db.all('SELECT id, title FROM posts WHERE deleted_at IS NULL ORDER BY created_at DESC', (err, posts) => {
      if (err) posts = [];
      res.render('admin/settings', {
        layout: false, bannerItems, featuredIds, posts, siteLang: currentLang,
        settings: siteSettings,
        // bannerRaw 供模板做"乐观锁"：提交时原样回传，用于判断页面是否已过期
        bannerRaw,
        csrfToken: req.csrfToken()
      });
    });
  });
});

// 站点设置（独立页面：Logo / 主题 / 关于我 / 页脚 / 语言 / 静态导出）
app.get('/admin/site', authOnly, csrfProtection, (req, res) => {
  const historyRows = safeParseJson(siteSettings.about_history || '[]');
  const aboutHistoryText = historyRows
    .map((it) => [it.date || '', it.title || '', it.desc || ''].join(' | '))
    .join('\n');
  res.render('admin/site', {
    layout: false, settings: siteSettings, siteLang: currentLang,
    aboutHistoryText,
    csrfToken: req.csrfToken()
  });
});

app.post('/admin/settings/language', authOnly, csrfProtection, (req, res) => {
  const lang = (req.body.site_lang || '').trim();
  if (!i18n.LANGS.includes(lang)) {
    return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.err.unsupportedLang')));
  }
  db.run('UPDATE settings SET site_lang = ? WHERE id = 1', [lang], function (err) {
    if (err) return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.err.saveFailed')));
    currentLang = lang;
    logAction(req, 'update_language', lang);
    res.redirect('/admin/settings?msg=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.msg.langUpdated')));
  });
});

// 站点个性化设置保存（站点标题/副标题/主题色/关于我/页脚文本）
// 站点设置字段清洗器：仅更新本次提交的字段（支持卡片式分表单保存，避免互相覆盖）
const SITE_FIELD_SETTERS = {
  site_title:      (v) => String(v == null ? '' : v).trim().slice(0, 60),
  site_subtitle:   (v) => String(v == null ? '' : v).trim().slice(0, 120),
  theme_color:     (v) => { const x = String(v == null ? '' : v).trim().slice(0, 16); return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(x) ? x : '#e60012'; },
  about_bio:       (v) => String(v == null ? '' : v).trim().slice(0, 1000),
  about_github:    (v) => String(v == null ? '' : v).trim().slice(0, 200),
  about_email:     (v) => String(v == null ? '' : v).trim().slice(0, 200),
  about_name:      (v) => String(v == null ? '' : v).trim().slice(0, 60),
  about_title:     (v) => String(v == null ? '' : v).trim().slice(0, 120),
  about_text:      (v) => String(v == null ? '' : v).trim().slice(0, 4000),
  about_tech:      (v) => parseTags(String(v == null ? '' : v).slice(0, 500)).slice(0, 24).join(','),
  // 履历：每行「日期 | 标题 | 描述」，存为 JSON 数组
  about_history:   (v) => {
    const rows = String(v == null ? '' : v)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((line) => {
        const parts = line.split('|').map((s) => s.trim());
        return {
          date: (parts[0] || '').slice(0, 40),
          title: (parts[1] || '').slice(0, 120),
          desc: (parts.slice(2).join('|') || '').slice(0, 600)
        };
      })
      .filter((it) => it.title || it.desc);
    return JSON.stringify(rows);
  },
  // 社交链接：前端提交 JSON 数组（已清洗），此处再校验一次
  social_links:    (v) => {
    // 类型白名单：未知类型降级为普通链接，绝不把任意字符串拼进 class/图标
    const ALLOWED = new Set(['github', 'email', 'bilibili', 'zhihu', 'x', 'telegram', 'wechat', 'link']);
    const safeSocialUrl = (u) => {
      const raw = String(u || '').trim().slice(0, 300);
      if (/^mailto:[^\s@]+@[^\s@]+$/i.test(raw)) return raw;
      return sanitizeUrl(raw);
    };
    try {
      const arr = JSON.parse(v);
      if (!Array.isArray(arr)) return '[]';
      const clean = arr.slice(0, 20).map((it) => {
        const type = String((it && it.type) || 'link').trim().slice(0, 20);
        return {
          type: ALLOWED.has(type) ? type : 'link',
          url: safeSocialUrl(it && it.url)
        };
      }).filter((it) => it.url);
      return JSON.stringify(clean);
    } catch (e) { return '[]'; }
  },
  footer_text:     (v) => String(v == null ? '' : v).trim().slice(0, 200),
  footer_subtitle: (v) => String(v == null ? '' : v).trim().slice(0, 200),
  // 图片路径：仅接受站内绝对路径（由上传路由写入；此处允许手动清空）
  site_logo:       (v) => { const x = String(v == null ? '' : v).trim().slice(0, 300); return /^\/[\w\-./]*$/.test(x) ? x : ''; },
  about_avatar:    (v) => { const x = String(v == null ? '' : v).trim().slice(0, 300); return /^\/[\w\-./]*$/.test(x) ? x : ''; }
};

// 统一大表单可携带 Logo / 头像文件（multipart）
const siteFormUpload = upload.fields([
  { name: 'site_logo_file', maxCount: 1 },
  { name: 'about_avatar_file', maxCount: 1 }
]);

// csrfProtection 必须放在 multer 之前：未通过 CSRF 校验的请求不应先落盘
app.post('/admin/settings/site', authOnly, csrfProtection, siteFormUpload, (req, res) => {
  const sets = [], vals = [];
  // 大表单中的图片文件（若已选择则覆盖对应字段）
  const logoFile = req.files && req.files.site_logo_file && req.files.site_logo_file[0];
  const avatarFile = req.files && req.files.about_avatar_file && req.files.about_avatar_file[0];
  if (logoFile) { sets.push('site_logo = ?'); vals.push(fileUrl(logoFile)); }
  else if (req.body.remove_logo) { sets.push('site_logo = ?'); vals.push(''); }
  if (avatarFile) { sets.push('about_avatar = ?'); vals.push(fileUrl(avatarFile)); }
  else if (req.body.remove_avatar) { sets.push('about_avatar = ?'); vals.push(''); }
  Object.keys(SITE_FIELD_SETTERS).forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      sets.push(`${k} = ?`);
      vals.push(SITE_FIELD_SETTERS[k](req.body[k]));
    }
  });
  if (!sets.length) {
    return res.redirect('/admin/site?msg=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.msg.siteSaved')));
  }
  db.run(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`, vals, function (err) {
    if (err) return res.redirect('/admin/site?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.err.saveFailed')));
    loadSiteSettings(() => {
      logAction(req, 'update_settings', 'site');
      res.redirect('/admin/site?msg=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.msg.siteSaved')));
    });
  });
});

// Logo / 头像上传（复用全局 multer 实例 upload，写入 settings 对应字段）
function handleSettingImage(field, column) {
  return (req, res) => {
    if (!req.file) {
      return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.err.uploadFailed')));
    }
    const url = fileUrl(req.file);
    db.run(`UPDATE settings SET ${column} = ? WHERE id = 1`, [url], (err) => {
      if (err) {
        console.error(`[${field}] 保存失败:`, err.message);
        return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.err.saveFailed')));
      }
      loadSiteSettings(() => {
        logAction(req, field, url);
        res.redirect('/admin/settings?msg=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.msg.uploaded')));
      });
    });
  };
}

// 同上：csrfProtection 在 multer 之前
app.post('/admin/settings/upload-logo', authOnly, csrfProtection, upload.single('logo'), handleSettingImage('upload_logo', 'site_logo'));
app.post('/admin/settings/upload-avatar', authOnly, csrfProtection, upload.single('avatar'), handleSettingImage('upload_avatar', 'about_avatar'));

// ============================================================
// 静态站导出（一键生成 / 打包下载）
// ============================================================
const { execFile: runExport } = require('child_process');

app.post('/admin/export-build', authOnly, csrfProtection, (req, res) => {
  const script = path.join(ROOT_DIR, 'scripts', 'export.js');
  runExport(process.execPath, [script], { cwd: ROOT_DIR, timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('[export-build] 失败:', stderr || err.message);
      return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.export.failed')));
    }
    logAction(req, 'export_build', 'dist');
    res.redirect('/admin/settings?msg=' + encodeURIComponent(i18n.t(currentLang, 'admin.export.built')));
  });
});

app.get('/admin/export-download', authOnly, (req, res) => {
  const distDir = path.join(ROOT_DIR, 'dist');
  if (!fs.existsSync(distDir)) {
    return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.export.noDist')));
  }
  const archiver = require('archiver');
  res.attachment('myblog-dist-' + Date.now() + '.zip');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (e) => {
    console.error('[export-download] 失败:', e.message);
    if (!res.headersSent) res.status(500).end();
  });
  archive.pipe(res);
  archive.directory(distDir, false);
  archive.finalize();
  logAction(req, 'export_download', 'dist');
});

app.post('/admin/settings', authOnly, csrfProtection, (req, res) => {
  const { bannerItems, featuredIds } = req.body;

  // 关键：只有"显式传了该字段"才更新对应列，未传的字段保持库中原值，
  // 避免"只保存推荐"时把已有 Banner 清空。
  const hasBanner   = typeof bannerItems !== 'undefined' && bannerItems !== null && bannerItems !== '';
  const hasFeatured = typeof featuredIds !== 'undefined' && featuredIds !== null && featuredIds !== '';

  let bannerJson = null, featuredJson = null;
  try {
    if (hasBanner) {
      const parsed = typeof bannerItems === 'string' ? JSON.parse(bannerItems) : bannerItems;
      if (!Array.isArray(parsed)) return res.status(400).send(i18n.t(currentLang, 'admin.settings.err.invalidData'));
      bannerJson = JSON.stringify(
        parsed.map(item => Object.assign({}, item, { image: sanitizeUrl(item && item.image) }))
      );
    }
    if (hasFeatured) {
      const parsed = typeof featuredIds === 'string' ? JSON.parse(featuredIds) : featuredIds;
      if (!Array.isArray(parsed)) return res.status(400).send(i18n.t(currentLang, 'admin.settings.err.invalidData'));
      featuredJson = JSON.stringify(parsed);
    }
  } catch(e) { return res.status(400).send(i18n.t(currentLang, 'admin.settings.err.invalidData')); }

  function doUpdate() {
    const sets = [], vals = [];
    if (bannerJson   !== null) { sets.push('banner_images = ?');     vals.push(bannerJson); }
    if (featuredJson !== null) { sets.push('featured_post_ids = ?'); vals.push(featuredJson); }

    if (!sets.length) {
      return res.redirect('/admin/settings?msg=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.msg.saved')));
    }
    db.run(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`, vals, function (err) {
      if (err) {
        console.error(err);
        return res.status(500).send(i18n.t(currentLang, 'error.500.message'));
      }
      logAction(req, 'update_settings', 'homepage');
      res.redirect('/admin/settings?msg=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.msg.saved')));
    });
  }

  // 改动 Banner 前做"乐观锁"：页面回传的 bannerVersion 必须与库中当前值一致。
  // 不一致说明页面是早先打开、未刷新的旧副本（可能带着陈旧甚至空的 banner），一律拒绝。
  if (bannerJson === null) return doUpdate();

  db.get('SELECT banner_images FROM settings WHERE id = 1', (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).send(i18n.t(currentLang, 'error.500.message'));
    }
    const current = (row && row.banner_images) || '[]';
    if (String(req.body.bannerVersion || '') !== current) {
      return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.err.staleBanner')));
    }
    doUpdate();
  });
});

app.post('/admin/settings/banner', authOnly, csrfProtection, (req, res) => {
  let parsed;
  try {
    parsed = typeof req.body.bannerItems === 'string'
      ? JSON.parse(req.body.bannerItems) : req.body.bannerItems;
  } catch (e) { return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.err.invalidData'))); }
  if (!Array.isArray(parsed)) return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.err.invalidData')));
  const cleaned = parsed
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .filter(item => item.postId || item.title || item.image)
    .map(item => Object.assign({}, item, {
      postId: Number(item.postId) || null,
      image: sanitizeUrl(item && item.image)
    }));

  // 同样的"乐观锁"：拒绝早先打开、未刷新的旧页面提交的 Banner，避免覆盖最新数据
  db.get('SELECT banner_images FROM settings WHERE id = 1', (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).send(i18n.t(currentLang, 'error.500.message'));
    }
    const current = (row && row.banner_images) || '[]';
    if (String(req.body.bannerVersion || '') !== current) {
      return res.redirect('/admin/settings?err=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.err.staleBanner')));
    }
    db.run(
      `UPDATE settings SET banner_images = ? WHERE id = 1`,
      [JSON.stringify(cleaned)],
      function(err) {
        if (err) {
          console.error(err);
          return res.status(500).send(i18n.t(currentLang, 'error.500.message'));
        }
        logAction(req, 'update_banner', 'homepage');
        res.redirect('/admin/settings?msg=' + encodeURIComponent(i18n.t(currentLang, 'admin.settings.msg.bannerSaved')));
      }
    );
  });
});

// ============================================================
// 操作日志
// ============================================================
app.get('/admin/logs', authOnly, csrfProtection, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const filterAction = (req.query.action || '').trim();
  const filterUser   = (req.query.user || '').trim();
  const filterIp     = (req.query.ip || '').trim();

  const where = [];
  const params = [];
  if (filterAction) { where.push('action = ?');      params.push(filterAction); }
  if (filterUser) {
    where.push("username LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(filterUser.slice(0, 100))}%`);
  }
  if (filterIp) {
    where.push("ip LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(filterIp.slice(0, 100))}%`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  db.get(`SELECT COUNT(*) AS c FROM logs ${whereSql}`, params, (err, row) => {
    const total = row ? row.c : 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    db.all(
      `SELECT * FROM logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
      (err, logs) => {
        if (err) logs = [];
        res.render('admin/logs', {
          layout: false, logs, page, totalPages, total,
          filterAction, filterUser, filterIp,
          csrfToken: req.csrfToken()
        });
      }
    );
  });
});

// ============================================================
// 错误页预览（仅调试用）
// ============================================================
app.get('/err/:code', (req, res) => {
  const t = (k) => i18n.t(currentLang, k);

  // 生产环境关闭该调试入口，避免被用来探测/放大
  if (IS_PRODUCTION) {
    return res.status(404).send(users.errorPage({
      status: 404, title: t('error.404.title'), message: t('error.404.message'),
      backUrl: '/', lang: currentLang
    }));
  }

  // 只接受标准 4xx/5xx，非数字或越界一律 400，绝不把任意值交给 res.status()
  const code = Number(req.params.code);
  if (!Number.isInteger(code) || code < 400 || code > 599) {
    return res.status(400).send(users.errorPage({
      status: 400,
      title: t('error.400.title') || t('error.defaultTitle'),
      message: t('error.400.message') || t('error.defaultMsg'),
      backUrl: '/', lang: currentLang
    }));
  }

  res.status(code).send(users.errorPage({
    status: code,
    title: t('error.' + code + '.title') || t('error.defaultTitle'),
    message: t('error.' + code + '.message') || t('error.defaultMsg'),
    backUrl: '/',
    lang: currentLang
  }));
});

// ============================================================
// 404
// ============================================================
app.use((req, res) => {
  res.status(404).send(users.errorPage({
    status: 404,
    title: i18n.t(currentLang, 'error.404.title'),
    message: i18n.t(currentLang, 'error.404.message'),
    lang: currentLang
  }));
});

// ============================================================
// 统一错误处理
// ============================================================
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  console.error(err.stack);

  const t = (k) => i18n.t(currentLang, k);
  const p = (obj) => users.errorPage({ lang: currentLang, ...obj });

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send(p({
      status: 413, title: t('error.413.title'), message: t('error.413.message'),
      backUrl: '/admin', backText: t('error.backAdmin')
    }));
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).send(p({
      status: 400, title: t('error.upload.title'), message: t('error.upload.message'),
      backUrl: '/admin', backText: t('error.backAdmin')
    }));
  }
  if (err.code === 'LIMIT_FIELD_COUNT' || err.code === 'LIMIT_FIELD_KEY') {
    return res.status(400).send(p({
      status: 400, title: t('error.form.title'), message: t('error.form.message'),
      backUrl: '/admin', backText: t('error.backAdmin')
    }));
  }
  if (err.code === 'LIMIT_FIELD_VALUE') {
    return res.status(400).send(p({
      status: 400, title: t('error.formValue.title'), message: t('error.formValue.message'),
      backUrl: '/admin', backText: t('error.backAdmin')
    }));
  }
  if (err.code === 'LIMIT_PART_COUNT') {
    return res.status(400).send(p({
      status: 400, title: t('error.form.title'), message: t('error.formPart.message'),
      backUrl: '/admin', backText: t('error.backAdmin')
    }));
  }
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).send(p({
      status: 403, title: t('error.csrf.title'), message: t('error.csrf.message'),
      backUrl: '/admin', backText: t('error.backAdmin')
    }));
  }
  if (err.message && err.message.includes('只允许上传')) {
    return res.status(400).send(p({
      status: 400, title: t('error.fileType.title'), message: err.message,
      backUrl: '/admin', backText: t('error.backAdmin')
    }));
  }

  res.status(500).send(p({
    status: 500, title: t('error.500.title'), message: t('error.500.message'),
    backUrl: '/', backText: t('error.backHome')
  }));
});

// ============================================================
// 启动
// ============================================================
app.listen(PORT, HOST, () => {
  console.log(`博客已启动: http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
  console.log(`后台地址: http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/admin`);
});