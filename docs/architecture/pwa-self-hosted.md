# PWA Self-hosted Architecture

This document describes the browser PWA and self-hosted Docker path.

## Ownership

- `apps/web` owns the Angular browser UI and PWA service worker configuration.
- `apps/web-backend` owns the browser-only backend proxy for remote playlist,
  XMLTV, Xtream, and Stalker requests.
- `docker/` owns the production self-hosted image that bundles the PWA and
  `web-backend` into one container.

The old external `4gray/iptvnator-backend` repository is not required for the
default self-hosted deployment. Sync behavior from that repository only when a
change intentionally restores or imports missing backend capabilities.

## Runtime Backend Configuration

The PWA reads `window.__IPTVNATOR_CONFIG__.BACKEND_URL` through
`apps/web/src/app/services/runtime-config.ts`. The static placeholder lives at
`apps/web/src/assets/app-config.js` and keeps hosted builds working without
Docker-specific values.

The Docker entrypoint rewrites `assets/app-config.js` at container startup.
`ngsw-config.json` explicitly excludes this file from Angular service worker
asset hashing so a runtime rewrite does not break cache validation.

## Service Worker Build

Use the PWA build configuration for browser deployments:

```bash
pnpm nx build web --configuration=pwa
```

The build must emit these files in `dist/apps/web`:

- `ngsw-worker.js`
- `ngsw.json`
- `safety-worker.js`
- `worker-basic.min.js`

`web:serve-static` serves `dist/apps/web` and builds with
`web:build:pwa`, so it exercises the same output layout as Docker. If Nx daemon
state returns stale service worker outputs while changing build options, run:

```bash
pnpm nx reset
pnpm nx build web --configuration=pwa --skip-nx-cache
```

## Web Backend

`apps/web-backend` exposes these routes:

- `GET /health`
- `GET /config.js`
- `GET /parse?url=<m3u-url>`
- `GET /parse-xml?url=<xmltv-url>`
- `GET /xtream?url=<server>&username=<u>&password=<p>&action=<action>`
- `GET /stalker?url=<portal.php>&macAddress=<mac>&action=<action>`

The PWA continues to use `PwaService`; only the backend base URL is resolved at
runtime. Electron routes remain owned by the Electron backend and preload
bridge.

Provider proxy routes validate the target URL before any outbound request:

- only `http:` and `https:` provider URLs are accepted
- URL credentials are rejected
- loopback, private, link-local, and reserved network targets are blocked by
  default
- `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1` explicitly enables trusted
  local/LAN targets for development, mock servers, or private deployments

Do not disable TLS certificate validation in the backend proxy. For private
certificate authorities, configure Node with `NODE_EXTRA_CA_CERTS`.

## PWA Portal User Data

Xtream favorites and recently viewed items use the browser-side
`PwaXtreamDataSource` when Electron DB preload APIs are unavailable. The PWA
stores this user activity in localStorage:

- `xtream-favorites`
- `xtream-recent-items`

Entries should include a content snapshot when the item is added. Global
collection routes and the dashboard can then restore titles, posters, content
type, and category IDs after navigation or a page reload without relying on the
Electron SQLite content table.

Shared collection services must not import `@iptvnator/portal/xtream/data-access`
directly. Use `XTREAM_COLLECTION_DATA_SOURCE` from
`@iptvnator/portal/shared/util` and bind it to `XTREAM_DATA_SOURCE` at the app
provider boundary (`apps/web/src/app/app.config.ts`). This keeps
`portal-shared-util` provider-neutral and avoids adding new Nx boundary cycles.

## Docker Runtime

The Docker image has two stages:

1. Build stage installs dependencies and runs `web:pwa` plus `web-backend`.
2. Runtime stage uses `node:22-alpine` with nginx installed. nginx serves
   `dist/apps/web` and proxies `/api/*` to the local Express backend.

Default runtime values:

- `BACKEND_URL=/api`
- `CLIENT_URL=http://localhost:4333`
- `PORT=3000`
- `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS` unset

When hosting behind another domain, set `CLIENT_URL` to the browser origin and
keep `BACKEND_URL=/api` unless the reverse proxy exposes the backend elsewhere.
Only set `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1` when the self-hosted
instance is restricted to trusted users and intentionally needs private
network IPTV targets.

## Validation

Use the narrow validation ladder for self-hosted changes:

```bash
pnpm nx test web-backend
pnpm nx test web --runTestsByPath apps/web/src/app/services/runtime-config.spec.ts
pnpm nx build web --configuration=pwa --skip-nx-cache
pnpm nx build web-backend
pnpm nx run web-e2e:e2e -- --project=chromium --grep @self-hosted
docker compose -f docker/docker-compose.yml config
```

Run `docker build -t iptvnator:self-hosted-test -f docker/Dockerfile .` when a
Docker daemon is available.

For manual Docker smoke testing, run the Xtream and Stalker mock servers plus a
small M3U fixture, then verify in the browser that M3U, Xtream, and Stalker
can add sources, play an item, toggle favorites, populate global favorites,
populate recently viewed, and appear on the dashboard rails.
