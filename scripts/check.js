#!/usr/bin/env node
'use strict';

/**
 * 轻量自检：npm run check
 *   1. 所有 JS 走 node --check（语法）
 *   2. 所有 EJS 走 ejs.compile（模板语法，不执行）
 *
 * 不依赖新增依赖（ejs 已是运行时依赖）。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'db', 'sessions', 'public/uploads', 'public/_tmp']);

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) { walk(full, out); continue; }
    out.push(full);
  }
}

const files = [];
walk(ROOT, files);

const jsFiles = files.filter((f) => f.endsWith('.js'));
const ejsFiles = files.filter((f) => f.endsWith('.ejs'));

let failed = 0;

console.log(`[check] JS ${jsFiles.length} 个，EJS ${ejsFiles.length} 个\n`);

for (const file of jsFiles) {
  const rel = path.relative(ROOT, file);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`[JS] ${rel}\n${(e.stderr || e.message).toString().split('\n').slice(0, 6).join('\n')}\n`);
  }
}

const ejs = require('ejs');
for (const file of ejsFiles) {
  const rel = path.relative(ROOT, file);
  try {
    const src = fs.readFileSync(file, 'utf8');
    // compile 只做语法检查，不渲染，所以 t / fmtTime 等运行时变量不会求值
    ejs.compile(src, { filename: file, client: false });
  } catch (e) {
    failed++;
    console.error(`[EJS] ${rel}\n${String(e.message).split('\n').slice(0, 5).join('\n')}\n`);
  }
}

if (failed) {
  console.error(`[check] 失败 ${failed} 个文件`);
  process.exit(1);
}

console.log('[check] 全部通过');