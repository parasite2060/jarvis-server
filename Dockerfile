# syntax=docker/dockerfile:1.7
FROM oven/bun:1-debian AS dependencies

WORKDIR /usr/src/app

COPY --chown=bun:bun package.json bun.lock* ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ==========================================

FROM oven/bun:1-debian AS build

WORKDIR /usr/src/app

COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock* ./
COPY --chown=bun:bun . .

RUN bun run build

# ==========================================

FROM oven/bun:1-debian AS production-deps

WORKDIR /usr/src/app

ENV HUSKY=0

COPY --chown=bun:bun package.json bun.lock* ./

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

# ==========================================

FROM oven/bun:1-debian AS production

WORKDIR /usr/src/app

ENV NODE_ENV=production \
    HUSKY=0

# git + gh CLI required by GitOpsService (Story 13.7) for vault repo operations
# and pull-request creation against the ai-memory repo.
RUN apt-get update && apt-get install -y --no-install-recommends git gh ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && git --version && gh --version

COPY --from=production-deps --chown=bun:bun /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /usr/src/app/dist ./dist
COPY --chown=bun:bun package.json ./

USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" || exit 1

CMD ["bun", "run", "dist/main.js"]
