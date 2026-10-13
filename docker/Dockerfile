# The Nx builds below emit platform-independent JS/static assets. During
# multi-arch publish builds, keep that heavy build stage on the native builder
# platform instead of running Node/Nx through QEMU for linux/arm64.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build

RUN apk add --no-cache python3 make g++ git

WORKDIR /usr/src/app

COPY .npmrc ./
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches

# Node 25 unbundled Corepack, so `corepack enable` cannot be the way pnpm gets
# installed here — it would break on the next base-image major. Install the
# exact pnpm from `packageManager` instead, which stays reproducible.
RUN PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1].split("+")[0]')" \
    && npm install --global "pnpm@${PNPM_VERSION}" \
    && pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# CI passes the git commit so Settings > About shows "<version> (<sha>)";
# the inject script is a no-op when BUILD_COMMIT is empty (local builds).
ARG BUILD_COMMIT=""
RUN node tools/build/inject-build-commit.mjs

RUN pnpm nx build web --configuration=pwa
RUN pnpm nx build web-backend

# better-sqlite3 is a native addon. This stage is NOT pinned to
# $BUILDPLATFORM, so multi-arch builds produce it for each target platform.
# prebuild-install downloads a musl binary when one exists and otherwise
# compiles with the toolchain below.
FROM node:24-alpine AS native

RUN apk add --no-cache python3 make g++

WORKDIR /opt/native

COPY package.json ./root-package.json

RUN BETTER_SQLITE3_VERSION="$(node -p 'require("./root-package.json").dependencies["better-sqlite3"]')" \
    && npm init -y >/dev/null \
    && npm install --omit=dev --no-audit --no-fund "better-sqlite3@${BETTER_SQLITE3_VERSION}"

FROM node:24-alpine

RUN apk add --no-cache gettext nginx

WORKDIR /opt/iptvnator

ENV PORT=3000
ENV BACKEND_URL=/api
ENV CLIENT_URL=http://localhost:4333
ENV IPTVNATOR_STORAGE=server
ENV IPTVNATOR_DATA_DIR=/data

COPY --from=build /usr/src/app/dist/apps/web /usr/share/nginx/html
COPY --from=build /usr/src/app/dist/apps/web-backend ./web-backend
COPY --from=native /opt/native/node_modules ./web-backend/node_modules
COPY docker/nginx.conf /etc/nginx/http.d/default.conf.template
COPY docker/docker-entrypoint.sh /usr/local/bin/iptvnator-entrypoint

RUN chmod +x /usr/local/bin/iptvnator-entrypoint && mkdir -p /data

VOLUME ["/data"]

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1

CMD ["iptvnator-entrypoint"]
