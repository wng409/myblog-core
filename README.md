# TechBlog CMS - Open Source Core Component

> A minimalist blog CMS based on Node.js, Express, and SQLite, ready to use out of the box.
> It is the only open-sourced component of the private project "Zero-Cost Cyber Fortress".

[![Node.js](https://img.shields.io/badge/Node.js-v22_LTS-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Language / 语言:** [English](README.md) | [简体中文](README.zh-CN.md)

---

## Overview and Relationship with the Full Version

- **Upstream Complete Project**: A personal private project (Proprietary), permanently closed-source. It runs on a self-hosted server behind a Cloudflare Tunnel, featuring automated backups, mirror synchronization, alerting and self-healing, status monitoring, multi-user roles, and custom page hosting. It holds real data and private configurations. Architecture whitepaper: https://github.com/wng409/myblog-showcase
- **This Repository (myblog-core)**: Extracts the independently runnable blog engine from the complete project, free of any privacy-related configurations, and releases it under the **MIT** License.
- **Summary**: Core is open-source, the Fortress is closed-source.

> Therefore, this repository is **NOT** the full source code of the complete version, nor does it contain any deployment scripts, secrets, private configurations, or personal data. It is a clean, independently runnable core.

### Feature Comparison

| Capability | This Repo (core, MIT) | Complete Version (Private, Proprietary) |
| --- | :---: | :---: |
| Frontend display + Article system | Yes | Yes |
| Admin Panel (Single Administrator) | Yes | Yes |
| Markdown writing + Image upload | Yes | Yes |
| Dark mode / Mobile adaptation | Yes | Yes |
| Operation logs / Recycle bin / Orphan image cleanup | Yes | Yes |
| Multi-language / i18n (zh / en / classical / mars built in) | Yes | No |
| Multi-user roles (admin / editor / viewer) | No | Yes |
| Server status monitoring page | No | Yes |
| Short posts (Moments) | No | Yes |
| Custom static page hosting | No | Yes |
| Automated backup / One-way mirror / Webhook alerts | No | Yes |
| Cloudflare Tunnel / Nginx production deployment | No | Yes |

> A "No" marks a capability not included in that column's version. Note: multi-language (i18n) is a core-only feature, not offered in the complete version.

## Core Philosophy

In an era where deploying a blog often requires going to the cloud, buying DDoS protection, or paying for CDNs, this system proves that with an elegant architecture, an enterprise-grade personal digital fortress can be built for zero cost. The complete version runs on a low-spec self-hosted node, penetrating the external network through a Cloudflare Tunnel for free DDoS protection and global acceleration. It boots on demand and goes offline when done, forming a physical disconnected defense. This repository opens the most core and least sensitive blog engine.

## Architecture Overview (Full Version)

```text
[ External Access ]
     |
     v
[ Cloudflare (Free DDoS Protection + Edge Cache + Tunnel) ]
     |
     v
[ Self-hosted Node (Intranet) ]
 |-- Node.js + Express + SQLite (WAL Mode)   <- Open-source part in this repo
 |-- EasyMDE (Fully localized)
 |-- Nginx Reverse Proxy
     |
     |--(Scheduled Clean Backup)--> [ Private Main Repo ] --(One-way Force Overwrite)--> [ Read-only Mirror ]
     |
     |--(Webhook)--> [ Real-time Alerts & Self-healing ]
```

> The diagram above describes the **complete version**; this repository only corresponds to the marked block.

## Security Design (Implemented in core)

- **Strict Content Security Policy (CSP)**: Same-origin scripts (`script-src 'self'`), blocking inline JS. The only anti-FOUC inline script is whitelisted using a **SHA-256 hash fingerprint**, minimizing XSS surface.
- **Application Layer Protection**: `helmet` + `csurf` (CSRF Token) + `express-rate-limit` (Login rate limiting) + `DOMPurify` (Input sanitization).
- **Password Security**: `scrypt` salted hash, constant-time comparison.
- **Upload Security**: `multer` whitelist validation for MIME and extensions, limits on size and field count.
- **Reverse Proxy Friendly**: `trust proxy` enabled to correctly identify `X-Forwarded-For`.

## Core Features

**Frontend**
- Homepage: Banner carousel + Featured posts + Latest posts
- Article list: Tag filtering, keyword search, time sorting
- Article detail: Markdown rendering, Bilibili video embedding
- Mobile adaptation + Dark mode (Follows system / Light / Dark)

**Admin Panel (Single Administrator)**
- Article management: Create / Edit / Delete, supports local upload or external image URL
- Recycle Bin: Soft delete, restore, permanent delete, empty, orphan image cleanup
- Homepage settings: Banner carousel and featured posts configuration
- Operation logs: Login, article, settings operations traced, supports filtering and pagination
- Profile: Modify username (including the built-in `admin` account) and password
- Internationalization: Switch the site language (English / Simplified Chinese) in Homepage settings

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js v22 LTS |
| Backend | Express 4 |
| Template | EJS + express-ejs-layouts |
| Database | SQLite3 (WAL Mode) |
| Markdown | markdown-it |
| Editor | EasyMDE (Localized) |
| Upload | multer |
| Session | express-session + session-file-store |
| Security | helmet + csurf + express-rate-limit + DOMPurify |

## Directory Structure

```text
myblog-core/
|-- app.js                 # App entry: Routes + Middleware
|-- lib/
|   |-- users.js           # Accounts, Auth, Logs, Error pages
|-- public/                # Static resources (css / js / uploads)
|-- views/                 # EJS templates
|   |-- layouts/           # Frontend layouts
|   |-- partials/          # Themes, admin nav, etc.
|   |-- posts/             # Post list / detail
|   |-- admin/             # Admin pages
|-- db/                    # SQLite DB (auto-created at runtime)
|-- sessions/              # Session files (auto-created at runtime)
|-- .env.example           # Env variable example
|-- package.json
```

## Requirements

- Node.js v22 LTS
- npm 10+
- Build tools (required for `sqlite3` native module): `build-essential`, `python3`

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Prepare environment variables
cp .env.example .env
# Edit .env, at least set SESSION_SECRET (openssl rand -base64 32)

# 3. Start
npm start
```

Visit frontend at `http://127.0.0.1:3000`, admin at `http://127.0.0.1:3000/admin`.

On first launch, `db/`, `sessions/`, and `public/uploads/` directories are auto-created, and a default admin is initialized:
- If `ADMIN_PASSWORD` is configured in `.env`, use that password;
- Otherwise, a random initial password is generated and printed in the startup log.

## Configuration

| Variable | Description |
| --- | --- |
| `PORT` | Listening port (default 3000) |
| `HOST` | Listening address (default `0.0.0.0`, set to `127.0.0.1` for local only) |
| `NODE_ENV` | `development` / `production` (affects Cookie Secure flag) |
| `SITE_NAME` | Site name (default `MyBlog`) |
| `SESSION_SECRET` | Session secret, required |
| `ADMIN_USERNAME` | Initial admin username (only effective on first launch) |
| `ADMIN_PASSWORD` | Initial admin password (only effective on first launch) |

> When `NODE_ENV=production`, cookies are only sent over HTTPS. Use `development` for local HTTP debugging.

## Deployment

For production, it is recommended to use systemd for daemonization and Nginx as a reverse proxy. Ensure `X-Forwarded-For` is passed through when proxying; the app has `trust proxy` enabled.

## Database Backup

In WAL mode, use the official SQLite backup command. Do not directly `cp` the main database file:

```bash
sqlite3 db/database.sqlite ".backup 'db/backup-$(date +%Y%m%d-%H%M%S).sqlite'"
```

## Bundled Third-Party Assets & Licenses

To avoid any runtime dependency on public CDNs — enabling true offline use and a stricter CSP — this repository **localizes (self-hosts)** every front-end asset that was originally loaded from a CDN. Their open-source licenses are declared below.

| Asset | Local Path | Version | Origin | License |
| --- | --- | --- | --- | --- |
| Font Awesome Free | `public/css/all.min.css`, `public/webfonts/*` | 6.4.0 | Originally loaded via the Cloudflare CDN (cdnjs) | Code: MIT; Icons: CC BY 4.0; Fonts: SIL OFL 1.1 |
| EasyMDE | `public/css/easymde.min.css`, `public/js/easymde.min.js` | 2.18.0 | Originally loaded via CDN | MIT |

### MIT License

Applies to the MIT-licensed code of the assets listed above; copyright remains with the original authors:

- EasyMDE — Copyright (c) Jeroen Akkerman
- Font Awesome Free (code) — Copyright (c) Fonticons, Inc.

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

> Font Awesome note: the code is MIT-licensed, while icons are licensed under CC BY 4.0 and fonts under SIL OFL 1.1. See https://fontawesome.com/license/free for details.

## Contributing: Localization (i18n)

The site ships with a zero-dependency i18n layer, and new languages or translation fixes are always welcome.

**How it works**

- Each language is a CommonJS module at `lib/i18n/<code>.js` exporting a flat `{ 'key': 'text' }` map.
- The loader `lib/i18n.js` scans that directory at startup and treats every `.js` file as an available language — no manual registration is needed.
- The default language is `zh`; any missing key falls back to `zh`.
- The language selector in **Admin → Home Settings** is rendered from the detected language list, and its display names come from `LANG_LABELS` in `lib/i18n.js`.

**Add a new language**

1. Copy `lib/i18n/en.js` (or `zh.js`) to `lib/i18n/<code>.js`, e.g. `fr.js`.
2. Translate the values, but **never add, rename, or remove keys** — keep the exact same key set as `zh.js` / `en.js`.
3. (Optional) Add a display name in `LANG_LABELS` inside `lib/i18n.js`, e.g. `fr: 'Français'`. Without it, the selector shows the raw language code.
4. Restart with `npm start`; the new language then appears in **Admin → Home Settings → Language**.

**Conventions**

- Keys use the `namespace.name` form (e.g. `nav.home`, `posts.search`, `admin.logs.title`).
- Keep values as plain text: do not introduce HTML, and do not change the concatenation/interpolation conventions used by existing entries.
- Runtime log messages and error pages use the same key set.

**Verify before submitting**

```bash
node -e "const a=Object.keys(require('./lib/i18n/zh.js')),b=Object.keys(require('./lib/i18n/fr.js'));console.log('missing:',a.filter(k=>!b.includes(k)));console.log('extra:',b.filter(k=>!a.includes(k)))"
```

**Contribution flow**: fork → create a branch → add or update the language file → open a PR against `main`, stating the language and how complete the translation is.

## License

- **This Repository (myblog-core)**: Open-sourced under the [MIT](./LICENSE) License. Free to use, modify, and distribute.
- **Bundled Third-Party Assets**: See [Bundled Third-Party Assets & Licenses](#bundled-third-party-assets--licenses).
- **Upstream Complete Project**: Personal private project (Proprietary), permanently closed-source. This repository does not contain its complete source code, deployment scripts, or private configurations. Unauthorized copying, modification, distribution, or commercial use is strictly prohibited without explicit written permission from the author.