# TechBlog CMS - 开源核心组件

> 一个基于 Node.js + Express + SQLite 的极简博客 CMS，开箱即用。
> 它同时是私有项目「0 元构建的赛博堡垒」中唯一对外开源的一部分。

[![Node.js](https://img.shields.io/badge/Node.js-v22_LTS-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Language / 语言:** [English](README.md) | [简体中文](README.zh-CN.md)

---

## 概览与完整版的关系

- **上游完整项目**：个人私有项目（Proprietary），永久闭源。运行在自托管服务器 + Cloudflare Tunnel 之上，包含自动备份、镜像同步、告警自愈、状态监控、多用户权限、自定义页面托管等一整套能力，并承载真实数据与私有配置。架构展示白皮书：https://github.com/wng409/myblog-showcase
- **本仓库（myblog-core）**：把完整项目中可独立运行、不依赖任何隐私配置的博客内核抽取出来，以 **MIT** 许可开源。
- **一句话概括**：core 开源，堡垒闭源。

> 因此，本仓库不是完整版的全部源码，也不包含任何部署脚本、密钥、私有配置或个人数据。它是一条能独立跑起来的干净内核。

### 包含 / 不包含对照

| 能力 | 本仓库（core，MIT） | 完整版（私有，Proprietary） |
| --- | :---: | :---: |
| 前台展示 + 文章系统 | 是 | 是 |
| 后台管理（单管理员） | 是 | 是 |
| Markdown 写作 + 图片上传 | 是 | 是 |
| 深色模式 / 移动端适配 | 是 | 是 |
| 操作日志 / 回收站 / 孤儿图片清理 | 是 | 是 |
| 多语言 / i18n（内置简中 / English / 文言文 / 火星文） | 是 | 否 |
| 多用户三级权限 | 否 | 是 |
| 服务器状态监控页 | 否 | 是 |
| 动态短文 | 否 | 是 |
| 自定义静态页面托管 | 否 | 是 |
| 自动备份 / 单向镜像 / Webhook 告警 | 否 | 是 |
| Cloudflare Tunnel / Nginx 生产部署 | 否 | 是 |

> 表中「否」表示对应版本不包含该能力。需注意：多语言（i18n）为 core 独有特性，完整版未提供。

## 核心理念

在一个动辄需要上云、买高防、付费 CDN 的时代，这套系统证明了：只要架构足够优雅，零成本也能构筑企业级的个人数字堡垒。完整版运行在一台低配自托管节点上，通过 Cloudflare Tunnel 穿透外网，享受免费的高防与全球加速；按需开机、用完即走，构成物理级别的断网防御。本仓库开源的，正是这套堡垒中最核心、也最不敏感的博客引擎。

## 架构全景概览（完整版）

```text
[ 外网访问 ]
     |
     v
[ Cloudflare (免费高防 + Edge Cache + Tunnel) ]
     |
     v
[ 自托管节点（内网） ]
 |-- Node.js + Express + SQLite (WAL 模式)   <- 本仓库开源部分
 |-- EasyMDE（全本地化加载）
 |-- Nginx 反代
     |
     |--(定时净量备份)--> [ 私有主仓库 ] --(单向强制覆盖)--> [ 只读镜像 ]
     |
     |--(Webhook)--> [ 实时告警与自愈 ]
```

> 上图描述的是完整版的架构；本仓库只对应其中标注的那一块。

## 安全设计（core 中已实现）

- **严格内容安全策略（CSP）**：全站同源脚本（`script-src 'self'`），禁止内联 JS；唯一的防闪烁内联脚本以 **SHA-256 哈希指纹放行**，从根源收敛 XSS 面。
- **应用层防护**：`helmet` + `csurf`（CSRF Token）+ `express-rate-limit`（登录限流）+ `DOMPurify` 输入清洗。
- **密码安全**：`scrypt` 加盐哈希、恒定时间比较。
- **上传安全**：`multer` 白名单校验 MIME 与扩展名，限制大小与字段数量；所有上传路由的 **CSRF 校验前置于 `multer`**，未携带合法 token 的请求在落盘之前即被拒绝。
- **设置并发保护**：「首页设置」表单会携带 Banner 配置的版本快照（`bannerVersion`），与库中当前值不一致时拒绝保存并提示「页面数据已过期」，避免早先打开、未刷新的旧页面覆盖甚至清空最新 Banner。
- **反向代理友好**：已开启 `trust proxy`，正确识别 `X-Forwarded-For`。

## core 功能

**前台**
- 首页：Banner 轮播 + 推荐文章 + 最新文章
- 文章列表：标签筛选、关键词搜索、时间排序
- 文章详情：Markdown 渲染、B 站视频嵌入
- 移动端适配 + 深色模式（跟随系统 / 浅色 / 深色）

**后台（单管理员账号）**
- 文章管理：新建 / 编辑 / 删除，支持本地上传或外链封面
- 回收站：软删除、恢复、彻底删除、清空、孤儿图片清理
- 首页管理：Banner 轮播（卡片式列表；移动端点击条目展开底部抽屉，含图片实时预览与纵向排布的编辑项）与推荐文章配置
- 操作日志：登录、文章、设置等操作留痕，支持筛选与分页
- 个人资料：修改用户名（含内置 `admin` 账号）与密码
- 多语言切换：在「首页设置」中切换前台语言（简体中文 / English / 文言文 / 火星文）

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 运行时 | Node.js v22 LTS |
| 后端 | Express 4 |
| 模板 | EJS + express-ejs-layouts |
| 数据库 | SQLite3（WAL 模式） |
| Markdown | markdown-it |
| 编辑器 | EasyMDE（已本地化） |
| 上传 | multer |
| 会话 | express-session + session-file-store |
| 安全 | helmet + csurf + express-rate-limit + DOMPurify |

## 目录结构

```text
myblog-core/
|-- app.js                 # 应用入口：路由 + 中间件
|-- lib/
|   |-- users.js           # 账号、鉴权、日志、错误页
|-- public/                # 静态资源（css / js / uploads）
|-- views/                 # EJS 模板
|   |-- layouts/           # 前台布局
|   |-- partials/          # 主题、后台导航等片段
|   |-- posts/             # 文章列表 / 详情
|   |-- admin/             # 后台页面
|-- db/                    # SQLite 数据库（运行时自动创建）
|-- sessions/              # 会话文件（运行时自动创建）
|-- .env.example           # 环境变量示例
|-- package.json
```

## 环境要求

- Node.js v22 LTS
- npm 10+
- 编译工具（安装 `sqlite3` 原生模块时需要）：`build-essential`、`python3`

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量
cp .env.example .env
# 编辑 .env，至少填入 SESSION_SECRET（openssl rand -base64 32）

# 3. 启动
npm start
```

访问前台 `http://127.0.0.1:3000`，后台 `http://127.0.0.1:3000/admin`。

首次启动会自动创建 `db/`、`sessions/`、`public/uploads/` 目录和默认管理员：
- 若 `.env` 中配置了 `ADMIN_PASSWORD`，使用该密码；
- 否则随机生成一个初始密码并打印在启动日志中。

## 配置说明

| 变量 | 说明 |
| --- | --- |
| `PORT` | 监听端口（默认 3000） |
| `HOST` | 监听地址（默认 `0.0.0.0`，设为 `127.0.0.1` 仅本机访问） |
| `NODE_ENV` | `development` / `production`（影响 Cookie Secure 标志） |
| `SITE_NAME` | 站点名称（默认 `MyBlog`） |
| `SESSION_SECRET` | 会话密钥，必填 |
| `ADMIN_USERNAME` | 初始管理员用户名（仅首次启动生效） |
| `ADMIN_PASSWORD` | 初始管理员密码（仅首次启动生效，留空则随机生成） |

> `NODE_ENV=production` 时 Cookie 只在 HTTPS 下发送，本地 http 调试请使用 `development`。

## 部署

一套最小可用的生产部署：**systemd** 常驻进程 + **Nginx** 终止 TLS 并反向代理。路径与域名按你自己的环境调整。

**1. 放置代码并安装依赖**

```bash
sudo mkdir -p /var/www/myblog-core && sudo chown "$USER":"$USER" /var/www/myblog-core
cd /var/www/myblog-core
# 把仓库放到这里（git clone / rsync / scp）
npm ci --omit=dev
```

**2. 配置 `.env`**

```bash
cp .env.example .env
```

```ini
HOST=127.0.0.1            # 只监听本机回环，对外由 Nginx 承接
PORT=3000
NODE_ENV=production       # Cookie 会带 Secure 标志，因此必须走 HTTPS
SITE_NAME=My Blog
SESSION_SECRET=<openssl rand -base64 32 生成>
ADMIN_USERNAME=admin      # 仅首次启动生效
ADMIN_PASSWORD=<一个强密码>
```

> `NODE_ENV=production` 会让 Cookie 带上 `Secure`，站点必须通过 HTTPS 访问；若只想用 http 试跑，请用 `development`。

**3. 创建可写目录**

应用运行时会创建并写入 `db/`（含 WAL 文件）、`sessions/`、`public/uploads/`。

```bash
mkdir -p db sessions public/uploads
chmod -R u+rwX db sessions public/uploads
```

**4. systemd 服务**

`/etc/systemd/system/myblog-core.service`：

```ini
[Unit]
Description=myblog-core
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/myblog-core
Environment=NODE_ENV=production
ExecStart=/usr/bin/node app.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now myblog-core
sudo systemctl status myblog-core --no-pager
```

> `User=www-data` 必须对 `db/`、`sessions/`、`public/uploads/` 有写权限（例如对这三个目录执行 `sudo chown -R www-data:www-data`）。

**5. Nginx 反向代理**

```nginx
server {
    listen 80;
    server_name blog.example.com;

    client_max_body_size 8m;   # 图片上传（multer 自身限制 5 MB）

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

准备启用 HTTPS 时，加上 `listen 443 ssl;` 与证书路径（如 `sudo certbot --nginx`）—— 若用 `NODE_ENV=production`，这一步是必需的。

**6. 验证**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/admin/login   # 期望 200
sudo journalctl -u myblog-core -n 30 --no-pager
```

**常见坑**

- **本机登录正常，经 Nginx 后登录不上** —— Cookie 带 `Secure` 而站点走的是 http。改用 HTTPS，或临时切到 `NODE_ENV=development`。
- **Nginx 返回 502** —— 服务没起来，或 `.env` 里的 `HOST`/`PORT` 与 `proxy_pass` 不一致。
- **上传报 500** —— `public/uploads/` 对服务运行用户不可写。
- **日志里的访客 IP 不对** —— 没有透传 `X-Forwarded-For`；应用已开启 `trust proxy`，依赖这个头。

## 数据库备份

WAL 模式下请使用 SQLite 官方备份命令，不要直接 `cp` 主库文件：

```bash
sqlite3 db/database.sqlite ".backup 'db/backup-$(date +%Y%m%d-%H%M%S).sqlite'"
```

## 本地化的第三方前端资源与开源许可

为摆脱对公共 CDN 的运行时依赖，实现真正的离线可用与更严格的 CSP，本仓库将原本通过 CDN 引入的前端资源全部**本地化自托管**，其开源许可声明如下。

| 资源 | 本地路径 | 版本 | 来源 | 许可 |
| --- | --- | --- | --- | --- |
| Font Awesome Free | `public/css/all.min.css`、`public/webfonts/*` | 6.4.0 | 原经 Cloudflare CDN（cdnjs）引入 | 代码 MIT；图标 CC BY 4.0；字体 SIL OFL 1.1 |
| EasyMDE | `public/css/easymde.min.css`、`public/js/easymde.min.js` | 2.18.0 | 原经 CDN 引入 | MIT |

### MIT License

以下 MIT 协议适用于上表资源中采用 MIT 许可的代码，版权归各原作者所有：

- EasyMDE — Copyright (c) Jeroen Akkerman
- Font Awesome Free（代码部分）— Copyright (c) Fonticons, Inc.

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> Font Awesome 说明：代码采用 MIT 许可，图标采用 CC BY 4.0，字体采用 SIL OFL 1.1，详见 https://fontawesome.com/license/free。

## 开发规范（CSP 与前端）

服务端通过 `helmet` 启用了严格的 CSP（见 `app.js`），其中 `scriptSrcAttr: 'none'`、`img-src 'self' data: https:`。所有前端代码必须遵守：

- **禁止使用内联事件（`onclick` / `onchange` / `oninput` 等）**：CSP 的 `scriptSrcAttr: 'none'` 会让浏览器直接拦截，表现为"点击无反应"，排查困难。所有事件必须在外部 JS 文件中通过 `addEventListener` 绑定，需要传参时使用 `data-*` 属性。
  - 示例：用 `<button data-file-target="siteLogoFile">` 搭配 `public/js/*.js` 中的 `document.querySelectorAll('[data-file-target]')`，而不是 `onclick="document.getElementById('siteLogoFile').click()"`。
- **本地图片预览必须使用 `data:` URL**：CSP 的 `img-src` 不允许 `blob:`，`URL.createObjectURL(...)` 会被拦截。请用 `FileReader` 读取文件，把 `readAsDataURL()` 的结果赋给 `img.src`。
- **禁止内联 `<script>` 代码块**：所有 JavaScript 统一放在 `public/js/` 下。
- `style` 行内属性可用（未限制 `style-src-attr`），但优先使用 `public/css/` 中定义的类名。

提交前自检（无输出即为通过）：

```bash
grep -rnE '\son[a-z]+="' views/
```

## 贡献指南：多语言（i18n）

本仓库内置零依赖的多语言方案，欢迎贡献新语言或完善现有翻译。

**工作原理**

- 每种语言是 `lib/i18n/<code>.js` 中的一个 CommonJS 模块，导出扁平的 `{ 'key': '译文' }` 映射。
- 加载器 `lib/i18n.js` 在启动时扫描该目录，把每个 `.js` 文件都视为一种可用语言——无需手动注册。
- 默认语言为 `zh`；缺失的 key 会自动回退到 `zh`。
- 后台「首页设置」中的语言下拉由检测到的语言列表动态渲染，显示名取自 `lib/i18n.js` 中的 `LANG_LABELS`。

**新增一种语言**

1. 复制 `lib/i18n/en.js`（或 `zh.js`）为 `lib/i18n/<code>.js`，例如 `fr.js`。
2. 翻译各项取值，但**不要新增、重命名或删除任何 key**——必须与 `zh.js` / `en.js` 保持完全一致的 key 集合。
3. （可选）在 `lib/i18n.js` 的 `LANG_LABELS` 中补充显示名，例如 `fr: 'Français'`；若不补充，下拉将显示语言代码本身。
4. 用 `npm start` 重启，新语言即出现在后台「首页设置 → 语言」中。

**约定**

- key 采用 `命名空间.名称` 形式（如 `nav.home`、`posts.search`、`admin.logs.title`）。
- 取值保持纯文本：不要引入 HTML，也不要改变现有条目的拼接 / 插值约定。
- 运行时日志与错误页同样使用这套 key。

**提交前自检**

```bash
node -e "const a=Object.keys(require('./lib/i18n/zh.js')),b=Object.keys(require('./lib/i18n/fr.js'));console.log('缺失:',a.filter(k=>!b.includes(k)));console.log('多余:',b.filter(k=>!a.includes(k)))"
```

**贡献流程**：fork → 新建分支 → 添加或更新语言文件 → 向 `main` 提交 PR，并说明语言种类与翻译完整度。

## 许可与协议

- **本仓库（myblog-core）**：以 [MIT](./LICENSE) 许可开源，可自由使用、修改、分发。
- **本地化第三方资源**：见[本地化的第三方前端资源与开源许可](#本地化的第三方前端资源与开源许可)。
- **上游完整项目**：个人私有项目（Proprietary），永久闭源。本仓库不包含其完整源码、部署脚本与私有配置，未经作者明确书面许可，禁止复制、修改、分发或用于任何商业用途。