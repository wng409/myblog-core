// lib/i18n.js —— 站点多语言加载器（无第三方依赖）
const fs = require('fs');
const path = require('path');

const DEFAULT_LANG = 'zh';

const i18nDir = path.join(__dirname, 'i18n');

const LANGS = fs
  .readdirSync(i18nDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => path.basename(file, '.js'))
  .sort((a, b) => {
    if (a === DEFAULT_LANG) return -1;
    if (b === DEFAULT_LANG) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

const MESSAGES = {};
for (const lang of LANGS) {
  MESSAGES[lang] = require(path.join(i18nDir, lang + '.js'));
}

function normalize(lang) {
  return LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

function t(lang, key) {
  const l = normalize(lang);
  const table = MESSAGES[l] || {};
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  const fallback = MESSAGES[DEFAULT_LANG] || {};
  if (Object.prototype.hasOwnProperty.call(fallback, key)) return fallback[key];
  return key;
}

const LANG_LABELS = { zh: '简体中文', en: 'English', classical: '文言文', mars: '火星文' };

function getLangLabel(code) {
  return LANG_LABELS[code] || code;
}

module.exports = { LANGS, DEFAULT_LANG, MESSAGES, LANG_LABELS, getLangLabel, t };
