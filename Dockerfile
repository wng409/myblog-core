# syntax=docker/dockerfile:1
# ============================================================
# myblog-core 运行镜像
#   - 多阶段构建：deps 阶段带编译工具链（sqlite3 需要），运行层不含工具链
#   - 数据目录 db / sessions / public/uploads 建议挂载为卷
#   - 首次启动会自动建表、创建默认管理员并打印初始密码
# ============================================================

# ---------- 1. 依赖安装（含原生模块编译） ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# sqlite3 为原生扩展，官方镜像无对应预编译包时会回落到源码编译
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npm cache clean --force

# ---------- 2. 运行镜像 ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# 运行时目录：与 app.js 的自动创建保持一致，并预先交给 node 用户
RUN mkdir -p /app/db /app/sessions /app/public/uploads /app/public/_tmp \
 && chown -R node:node /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node
EXPOSE 3000

# 健康检查：用 Node 内置 http，避免为 curl 额外安装包
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "app.js"]