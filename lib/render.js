'use strict';

/**
 * 渲染相关公共实现
 * ------------------------------------------------------------
 * fmtTime 是唯一的时间格式化实现：app.js（页面渲染）与 scripts/export.js（SSG）
 * 都从这里引用，避免两边各写一份导致格式漂移（例如时区不一致）。
 */

const SITE_TZ = process.env.SITE_TZ || 'Asia/Shanghai';

function fmtTime(t) {
  if (!t) return '';
  let iso = String(t).trim();
  if (!iso.includes('T')) iso = iso.replace(' ', 'T');
  if (!/[Z+]/.test(iso)) iso += 'Z';
  const d = new Date(iso);
  if (isNaN(d)) return t;

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: SITE_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(d);

  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : '00';
  };
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

module.exports = { fmtTime, SITE_TZ };
