# The Nx builds below emit platform-independent JS/static assets. During
# multi-arch publish builds, keep that heavy build stage on the native builder
# platform instead of running Node/Nx through QEMU for linux/arm64.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

RUN apk add --no-cache python3 make g++ git

WORKDIR /usr/src/app

COPY .npmrc ./
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

COPY . .

RUN pnpm nx build web --configuration=pwa
RUN pnpm nx build web-backend

FROM node:22-alpine

RUN apk add --no-cache gettext nginx

WORKDIR /opt/iptvnator

ENV PORT=3000
ENV BACKEND_URL=/api
ENV CLIENT_URL=http://localhost:4333

COPY --from=build /usr/src/app/dist/apps/web /usr/share/nginx/html
COPY --from=build /usr/src/app/dist/apps/web-backend ./web-backend
COPY docker/nginx.conf /etc/nginx/http.d/default.conf.template
COPY docker/docker-entrypoint.sh /usr/local/bin/iptvnator-entrypoint

RUN chmod +x /usr/local/bin/iptvnator-entrypoint

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1

CMD ["iptvnator-entrypoint"]
