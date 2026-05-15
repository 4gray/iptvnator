# Self-hosted IPTVnator

The self-hosted image contains both pieces required for the browser PWA:

- Angular PWA static files served by nginx
- The monorepo `web-backend` Express app proxied under `/api`

The historical standalone `4gray/iptvnator-backend` image is no longer needed
for the default Docker deployment.

## Run With Docker Compose

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

By default the app is available at <http://localhost:4333>.

## Build The Image

```bash
docker build -t 4gray/iptvnator -f docker/Dockerfile .
```

The image build runs:

```bash
pnpm nx build web --configuration=pwa
pnpm nx build web-backend
```

## Runtime Configuration

The container writes `/usr/share/nginx/html/assets/app-config.js` on startup.
That file sets `window.__IPTVNATOR_CONFIG__.BACKEND_URL`, which the PWA reads
before it creates `PwaService`.

| Variable                                  | Default                 | Purpose                                                                                                            |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `BACKEND_URL`                             | `/api`                  | Browser-facing backend URL used by the PWA. Keep `/api` for the bundled nginx proxy.                               |
| `CLIENT_URL`                              | `http://localhost:4333` | Allowed browser origin for backend CORS. Use the public URL when hosting behind a reverse proxy.                   |
| `PORT`                                    | `3000`                  | Internal Express backend port. nginx proxy config is patched to match it at container startup.                     |
| `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS`  | unset                   | Set to `1` only for trusted local/LAN deployments that intentionally proxy private network IPTV or mock endpoints. |

The web backend proxy accepts only `http` and `https` provider URLs. It blocks
loopback, private, link-local, and reserved network targets by default so a
publicly exposed instance cannot be used as a generic internal-network fetcher.
If you enable `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1`, keep the instance
restricted to trusted users.

For providers that use private certificate authorities, keep TLS validation
enabled and pass the CA bundle to Node with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

The nginx config serves the PWA with SPA fallback, avoids caching
`assets/app-config.js`, and proxies `/api/*` to the internal backend.

## Local Validation

```bash
pnpm nx test web-backend
pnpm nx build web --configuration=pwa --skip-nx-cache
pnpm nx build web-backend
pnpm nx run web-e2e:e2e -- --project=chromium --grep @self-hosted
docker compose -f docker/docker-compose.yml config
```
