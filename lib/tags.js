/**
 * 标签（Tag）工具集
 * ------------------------------------------------------------
 * 目前 tags 仍以「逗号分隔的字符串」存在 posts.tags 这一列里，
 * 所以解析规则必须只有一份，避免各页面各写一套 split。
 *
 * 约定（入库后）：
 *   - 英文逗号分隔，标签之间没有空格
 *   - 全部小写
 *   - 无重复项、无不可见字符
 *   - 单个标签最长 24 个字符
 *
 * normalizeTags(raw)  → 入库清洗（写）
 * parseTags(raw)      → 读取展示（读），返回干净数组
 * escapeLike(str)     → SQL LIKE 参数转义（查）
 */

'use strict';

const MAX_TAG_LEN = 24;

// 可接受的分隔符：半角/全角逗号、顿号、分号、冒号、竖线、斜杠、任意空白
const SEPARATOR_RE = /[,，、;；:：|｜/\\\s]+/;

// 不可见字符：C0 控制符（保留 \t \n \r 作为分隔符）、DEL、软连字符、零宽字符、方向控制符、BOM
const INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFFD]/g;

// 标签两端的包裹引号
const WRAP_QUOTE_RE = /^["'“”‘’]+|["'“”‘’]+$/g;

/**
 * 按 Unicode 码点截断，避免把 emoji / 代理对切成半个字符
 */
function truncate(str, max) {
  const chars = Array.from(str);
  if (chars.length <= max) return str;
  return chars.slice(0, max).join('').trim();
}

/**
 * 入库前的统一清洗
 * @param {string|string[]|null|undefined} rawString 后台表单收到的原始标签串
 * @returns {string} 形如 "html,css,javascript"；无可保留标签时返回 ''
 */
function normalizeTags(rawString) {
  if (rawString === null || rawString === undefined) return '';

  const raw = Array.isArray(rawString) ? rawString.join(',') : String(rawString);
  // NFKC：全角字母/数字/标点转半角（ＨＴＭＬ → HTML，全角逗号 → 半角逗号）
  const text = raw.normalize('NFKC').replace(INVISIBLE_RE, '');

  const seen = new Set();
  const out = [];

  text.split(SEPARATOR_RE).forEach(function (part) {
    let tag = part.trim().toLowerCase();
    tag = tag.replace(WRAP_QUOTE_RE, '').trim();   // 去掉 "vue" / 'vue' 这类包裹引号
    if (!tag) return;

    tag = truncate(tag, MAX_TAG_LEN);
    if (!tag || seen.has(tag)) return;

    seen.add(tag);
    out.push(tag);
  });

  return out.join(',');
}

/**
 * 读取展示用：把库里的字符串拆成干净数组
 * 保留历史数据的大小写（不做 toLowerCase），仅做 trim / 去空 / 去重
 * @param {string|null|undefined} tagsString
 * @returns {string[]}
 */
function parseTags(tagsString) {
  if (tagsString === null || tagsString === undefined) return [];

  const raw = Array.isArray(tagsString) ? tagsString.join(',') : String(tagsString);
  const text = raw.normalize('NFKC').replace(INVISIBLE_RE, '');

  const seen = new Set();
  const out = [];

  text.split(SEPARATOR_RE).forEach(function (part) {
    const tag = part.trim();
    if (!tag) return;

    const key = tag.toLowerCase();   // 去重按小写判定，展示保留原始写法
    if (seen.has(key)) return;

    seen.add(key);
    out.push(tag);
  });

  return out;
}

/**
 * 转义 SQL LIKE 的通配符，配合 "... LIKE ? ESCAPE '\'" 使用
 * @param {string} str
 * @returns {string}
 */
function escapeLike(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[\\%_]/g, function (ch) {
    return '\\' + ch;
  });
}

module.exports = {
  normalizeTags,
  parseTags,
  escapeLike,
  MAX_TAG_LEN
};