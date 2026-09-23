# syntax=docker/dockerfile:1.7
# Multi-stage build → small standalone Next.js image that runs as a non-root user.
#
#   docker build -t gst-recon .
#   docker run --env-file .env -p 3000:3000 gst-recon
#
# Database migrations are NOT run at container start by default (so several replicas can't race).
# Run them once per release:  docker compose run --rm migrate      (or `npx prisma migrate deploy`)

ARG NODE_VERSION=20

# ── 1. dependencies ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate

# ── 2. build ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1 \
    BUILD_STANDALONE=true
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only – real values are provided when the container runs. Nothing secret is baked into the image.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    DATABASE_URL_UNPOOLED="postgresql://build:build@localhost:5432/build" \
    NEXTAUTH_SECRET="build-time-placeholder" \
    NEXTAUTH_URL="http://localhost:3000" \
    npm run build

# ── 3. migration runner (has the Prisma CLI; used by `docker compose run migrate`) ─
FROM node:${NODE_VERSION}-bookworm-slim AS migrate
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
CMD ["npx", "prisma", "migrate", "deploy"]

# ── 4. runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
