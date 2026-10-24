#!/usr/bin/env node
/**
 * 全站静态导出脚本（SSG）—— myblog-core 极简版
 *
 * 用法：npm run export   （或 node scripts/export.js）
 * 输出：dist/ 目录（纯静态，可部署 GitHub Pages / Cloudflare Pages）
 *
 * 产物清单：
 *   dist/index.html              首页（Banner 轮播 + 推荐文章 + 最新文章）
 *   dist/posts.html              文章列表页（服务端渲染全量；分页器在静态站隐藏，由 static-search.js 接管）
 *   dist/posts/{slug}.html       文章详情页
 *   dist/api/posts.json          文章索引（供前端静态搜索，剔除正文大字段）
 *   dist/css|js|webfonts|...     public/ 全量拷贝
 *
 * 说明：
 *   - 本脚本只读数据库与模板，不启动 Express，绝不影响线上动态站。
 *   - 采用等价于 express-ejs-layouts 的“两层渲染”：页面模板 → body，再套 layout.ejs。
 *   - 所有渲染统一注入：isStatic: true、fmtTime、t（i18n 翻译，默认中文）、siteName。
 *   - 与闭源版差异（core 极简）：无 moments、无 banner/featured 独立查询、无 mc/hutao；posts 无多用户 author 字段。
 */

const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const sqlite3 = require('sqlite3');
const MarkdownIt = require('markdown-it');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const i18n = require('../lib/i18n');

// ============================================================
// 常量
// ============================================================
const ROOT_DIR = path.join(__dirname, '..');
const VIEWS_DIR = path.join(ROOT_DIR, 'views');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DB_PATH = path.join(ROOT_DIR, 'db', 'database.sqlite');

const EXCERPT_LEN = 200;          // posts.json 摘要长度
const HOME_LATEST_LIMIT = 6;      // 首页“最新文章”条数（与 app.js 一致）
const HOME_FEATURED_LIMIT = 3;    // 首页“推荐文章”条数（静态站由最新文章派生）
const HOME_BANNER_LIMIT = 5;      // 首页 Banner 条数（静态站由最新文章派生）
const SITE_NAME = process.env.SITE_NAME || 'MyBlog';
let CURRENT_SETTINGS = {};                  // 导出期站点个性化设置（main 中加载后注入模板）
const SOCIAL_ICONS = { github: 'fab fa-github', email: 'fas fa-envelope', bilibili: 'fab fa-bilibili', zhihu: 'fab fa-zhihu', x: 'fab fa-x-twitter', telegram: 'fab fa-telegram', wechat: 'fab fa-weixin', link: 'fas fa-link' };
const SOCIAL_LABELS = { github: 'GitHub', email: 'Email', bilibili: 'Bilibili', zhihu: '知乎', x: 'X', telegram: 'Telegram', wechat: '微信', link: '' };
let SOCIAL_LINKS = [];                      // 导出期社交链接（已解析为数组）
const LANG = i18n.DEFAULT_LANG;             // 导出默认使用中文
const t = (key) => i18n.t(LANG, key);       // 导出期翻译函数（注入模板）

const md = new MarkdownIt({ html: false, linkify: true });
const DOMPurify = createDOMPurify(new JSDOM('').window);

// ============================================================
// fmtTime：与 app.js app.locals.fmtTime 逐字一致（app.js:342）
// ============================================================
const fmtTime = function (t) {
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

// ============================================================
// 工具函数
// ============================================================
const dbAll = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r || []))));

const dbGet = (db, sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r))));

// 生成纯文本摘要（剔除 HTML 标签后截断）
function makeExcerpt(content) {
  if (!content) return '';
  const text = String(content).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_LEN ? text.slice(0, EXCERPT_LEN) + '...' : text;
}

// 与 app.js 的 renderMarkdownCached 输出保持一致：markdown-it 渲染 + DOMPurify 清洗
function renderMarkdown(content) {
  return rewriteInternalLinks(DOMPurify.sanitize(md.render(content || '')));
}

// 正文内相对链接补全（仅导出后处理，不改模板）：
//   静态站详情页为 /posts/{slug}.html，故将正文中 href="/posts/{slug}" 补全为 .html。
//   边界：已以 .html 结尾的不动；/posts.html 不匹配；保留 ?query / #hash；外部链接与 # 锚点不匹配。
function rewriteInternalLinks(html) {
  return String(html).replace(/href="\/posts\/([^"?#]+)([?#][^"]*)?"/g, function (m, slugPath, suffix) {
    if (slugPath.slice(-5) === '.html') return m;
    var slug = slugPath.replace(/\/$/, '');
    return 'href="/posts/' + slug + '.html' + (suffix || '') + '"';
  });
}

// 渲染页面模板（中间内容），统一注入 isStatic / fmtTime / t
async function renderBody(view, data) {
  return ejs.renderFile(
    path.join(VIEWS_DIR, view),
    Object.assign({
      isStatic: true, fmtTime, t,
      settings: Object.assign({}, CURRENT_SETTINGS, { social_links: SOCIAL_LINKS }),
      socialIcons: SOCIAL_ICONS,
      socialLabels: SOCIAL_LABELS
    }, data)
  );
}

// 两层渲染：页面模板 → layout.ejs（等价于 express-ejs-layouts 的行为）
// 注入 core layout 契约：titleKey / title + siteName + t + isStatic + fmtTime
async function renderPage(view, data) {
  const body = await renderBody(view, data);
  return ejs.renderFile(
    path.join(VIEWS_DIR, 'layouts/layout.ejs'),
    {
      body,
      titleKey: data.titleKey,
      title: data.title || SITE_NAME,
      siteName: CURRENT_SETTINGS.site_title || SITE_NAME,
      settings: Object.assign({}, CURRENT_SETTINGS, { social_links: SOCIAL_LINKS }),
      socialIcons: SOCIAL_ICONS,
      socialLabels: SOCIAL_LABELS,
      // darkMode 不传：静态站无 session，服务端不输出 dark class，
      // 主题完全交给 head 内 theme-init 同步脚本处理（防闪烁）
      isStatic: true,
      fmtTime,
      t
    }
  );
}

async function writeFileSafe(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  // 0. 前置检查
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[错误] 未找到数据库文件：${DB_PATH}`);
    console.error('请先在项目根目录运行 node app.js 完成初始化，再执行导出。');
    process.exit(1);
  }

  const t0 = Date.now();
  const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

  // 1. 清空并重建 dist/，全量拷贝 public/ 静态资源
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(PUBLIC_DIR)) {
    fs.cpSync(PUBLIC_DIR, DIST_DIR, { recursive: true });
    console.log('[OK] public/ 静态资源已拷贝至 dist/');
  }

  // 2. 读取文章数据（core 为单用户，无 author 联查；LENGTH(content) 供阅读时长，不读正文）
  const posts = await dbAll(db, `
    SELECT id, title, slug, tags, cover_image, bilibili_embed,
           created_at, updated_at, LENGTH(content) AS content_len
    FROM posts
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC`);

  // 2.1 站点个性化设置（标题/副标题/主题色/关于我/页脚），注入模板
  CURRENT_SETTINGS = (await dbGet(db, 'SELECT site_title, site_subtitle, theme_color, about_bio, about_github, about_email, social_links, footer_text, footer_subtitle, site_logo, about_avatar FROM settings WHERE id = 1')) || {};
  try { const arr = JSON.parse(CURRENT_SETTINGS.social_links || '[]'); SOCIAL_LINKS = Array.isArray(arr) ? arr : []; } catch (e) { SOCIAL_LINKS = []; }

  // 3. 生成 dist/api/posts.json（剔除正文大字段，只留搜索所需）
  //    正文单独一次性查出建立 contentMap（第 6 步详情页复用，避免 N+1）
  const contentMap = {};
  if (posts.length > 0) {
    const contents = await dbAll(db, 'SELECT slug, content FROM posts WHERE deleted_at IS NULL');
    contents.forEach(c => { contentMap[c.slug] = c.content; });
  }

  const postsJson = posts.map(p => ({
    slug: p.slug,
    title: p.title,
    tags: p.tags || '',
    created_at: p.created_at,
    content_excerpt: makeExcerpt(contentMap[p.slug] || '')
  }));
  await writeFileSafe(
    path.join(DIST_DIR, 'api', 'posts.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), posts: postsJson }, null, 2)
  );
  console.log(`[OK] dist/api/posts.json 已生成（${postsJson.length} 篇）`);

  // 4. 首页 index.html
  //    core 极简：不单独查询 banner/featured；由最新文章平滑派生，保证首页不报错且视觉完整
  const latestPosts = posts.slice(0, HOME_LATEST_LIMIT);
  const featuredPosts = posts.slice(0, HOME_FEATURED_LIMIT);
  const bannerPosts = posts.slice(0, HOME_BANNER_LIMIT).map(p => ({
    title: p.title, image: p.cover_image || '', slug: p.slug
  }));

  const indexHtml = await renderPage('index.ejs', {
    titleKey: 'nav.home',
    bannerPosts,
    featuredPosts,
    latestPosts
  });
  await writeFileSafe(path.join(DIST_DIR, 'index.html'), indexHtml);
  console.log('[OK] dist/index.html 已生成');

  // 5. 文章列表页 posts.html
  //    服务端渲染全量文章（currentPage=1/totalPages=1 → 分页器隐藏）；
  //    搜索与纯前端分页由 static-search.js 接管（消费 dist/api/posts.json）。
  const allTags = [];
  const tagSet = new Set();
  posts.forEach(p => {
    if (p.tags) p.tags.split(',').forEach(x => tagSet.add(x.trim()));
  });
  tagSet.forEach(x => allTags.push(x));

  const postsHtml = await renderPage('posts/list.ejs', {
    titleKey: 'nav.posts',
    posts,
    tags: allTags,
    currentTag: '',
    search: '',
    sort: 'desc',
    currentPage: 1,
    totalPages: 1
  });
  await writeFileSafe(path.join(DIST_DIR, 'posts.html'), postsHtml);
  console.log('[OK] dist/posts.html 已生成');

  // 6. 文章详情页 dist/posts/{slug}.html
  //    slug 合法性校验放在渲染之前：非法 slug 直接跳过，不浪费一次渲染
  let detailCount = 0;
  for (const post of posts) {
    const slug = String(post.slug || '');
    if (!slug || slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
      console.warn(`[跳过] 文章 id=${post.id} 的 slug 非法：${JSON.stringify(slug)}`);
      continue;
    }
    const html = await renderPage('posts/detail.ejs', {
      title: post.title,
      post: Object.assign({}, post, {
        htmlContent: renderMarkdown(contentMap[post.slug] || '')
      })
    });
    await writeFileSafe(path.join(DIST_DIR, 'posts', `${slug}.html`), html);
    detailCount++;
  }
  console.log(`[OK] dist/posts/{slug}.html 已生成（${detailCount} 篇）`);

  // 7. 收尾
  db.close();
  console.log(`\n导出完成：共 ${posts.length} 篇文章，耗时 ${Date.now() - t0} ms`);
  console.log(`输出目录：${DIST_DIR}`);
}

main().catch((err) => {
  console.error('[导出失败]', err);
  process.exit(1);
});