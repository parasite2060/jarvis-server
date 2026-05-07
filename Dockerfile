# syntax=docker/dockerfile:1.7
FROM dhi.io/bun:1 AS dependencies

WORKDIR /usr/src/app

COPY --chown=bun:bun package.json bun.lock* ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ==========================================

FROM dhi.io/bun:1 AS build

WORKDIR /usr/src/app

COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock* ./
COPY --chown=bun:bun . .

RUN bun run build

# ==========================================

FROM dhi.io/bun:1 AS production-deps

WORKDIR /usr/src/app

ENV HUSKY=0

COPY --chown=bun:bun package.json bun.lock* ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

# ==========================================

FROM dhi.io/bun:1 AS production

WORKDIR /usr/src/app

ENV NODE_ENV=production \
    HUSKY=0

COPY --from=production-deps --chown=bun:bun /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /usr/src/app/dist ./dist
COPY --chown=bun:bun package.json ./

USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" || exit 1

CMD ["bun", "run", "dist/main.js"]
