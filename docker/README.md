# Self-hosted IPTVnator

The self-hosted image contains both pieces required for the browser PWA:

- Angular PWA static files served by nginx
- The monorepo `web-backend` Express app proxied under `/api`

The historical standalone `4gray/iptvnator-backend` image is no longer needed
for the default Docker deployment.

## PWA Limitations And Playback Troubleshooting

The Docker image runs the browser PWA, not the Electron desktop application.
That means:

- EPG/XMLTV panels and multi-EPG views are not available in the self-hosted PWA.
- Playlist metadata is stored in the browser through IndexedDB, and Xtream user
  data is stored by the PWA data source in localStorage. The PWA does not use
  the Electron SQLite database or DB worker.
- Docker cannot launch local desktop players or Embedded MPV. If a stream does
  not play inline in the browser, use the in-app copy URL action and open the
  stream manually in an external player such as MPV, VLC, or IINA.
- Electron-only features such as the download manager, external-player process
  control, and remote-control integrations are outside this runtime.

## Run With Docker Compose

From the repository root:

```bash
docker compose -f docker/docker-compose.yml up --build -d
```

The ready-to-run compose file is [`docker-compose.yml`](./docker-compose.yml).
By default the app is available at <http://localhost:4333>. No additional
environment variables, backend repository checkout, or separate backend
container are required for the default local deployment.

## Build The Image

```bash
docker build -t 4gray/iptvnator -f docker/Dockerfile .
```

The image build runs:

```bash
pnpm nx build web --configuration=pwa
pnpm nx build web-backend
```

Those Nx builds generate platform-independent JS and static assets. In
multi-architecture CI builds, the Dockerfile runs this build stage on the native
BuildKit builder platform, then copies the generated output into each target
runtime image. That avoids running the Angular/Nx build through QEMU when
publishing `linux/amd64` and `linux/arm64` images.

## Published Docker Tags

Pull request builds validate the Dockerfile without pushing an image. Docker
Hub publishing happens only from trusted repository events.
Publishing requires the repository secrets `DOCKERHUB_USERNAME` and
`DOCKERHUB_TOKEN`; pull request builds and default manual runs do not use those
secrets.

| Tag pattern                | Published from           | Use case                                                                  |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `latest`                   | `master` pushes          | Default self-hosted image for users who want the newest merged PWA build. |
| `<version>-pwa`            | `master` pushes          | Latest PWA image for the current `package.json` version.                  |
| `<version>-pwa-<sha>`      | `master` pushes          | Immutable PWA image for a specific merged commit within a version.        |
| `sha-<sha>`                | `master` pushes          | Commit-addressable image, useful for rollback and support diagnostics.    |
| `<version>` / `v<version>` | `v*` release tags        | Release image aligned with a repository release tag.                      |
| `stable`                   | Stable `v*` release tags | Most recent non-prerelease tagged release image.                          |
| `manual-<sha>`             | Manual runs with `push`  | Explicit maintainer-triggered rebuilds outside normal publish events.     |

Use `latest` for the simplest self-hosted setup. Pin `sha-<sha>` or
`<version>-pwa-<sha>` when you need reproducible deployments. Use release tags
when you want the Docker image to track a tagged IPTVnator release rather than
every merge to `master`.

## Runtime Configuration

The container writes `/usr/share/nginx/html/assets/app-config.js` on startup.
That file sets `window.__IPTVNATOR_CONFIG__.BACKEND_URL`, which the PWA reads
before it creates `PwaService`.

These variables are supported by the Docker image. The compose file sets the
safe local defaults shown below.

| Variable                                 | Default                 | Purpose                                                                                                                                      |
| ---------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKEND_URL`                            | `/api`                  | Browser-facing backend URL used by the PWA. Keep `/api` for the bundled nginx proxy.                                                         |
| `CLIENT_URL`                             | `http://localhost:4333` | Allowed browser origin for backend CORS. Use the public URL when hosting behind a reverse proxy. Multiple origins can be comma-separated.    |
| `PORT`                                   | `3000`                  | Internal Express backend port. nginx proxy config is rendered from the template to match it at startup.                                      |
| `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS` | `0`                     | Set to `1` or `true` only for trusted local/LAN deployments that intentionally proxy private network IPTV or mock endpoints.                 |
| `NODE_EXTRA_CA_CERTS`                    | unset                   | Optional Node.js CA bundle path for providers using private certificate authorities. Mount the CA file into the container and set this path. |

The web backend proxy accepts only `http` and `https` provider URLs. The PWA
first registers provider URLs through `/provider-targets`, then uses the
returned `targetId` for playlist, Xtream, and Stalker proxy calls. The backend
blocks loopback, private, link-local, and reserved network targets by default so
a publicly exposed instance cannot be used as a generic internal-network
fetcher. If you enable `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1`, keep the
instance restricted to trusted users.

For providers that use private certificate authorities, keep TLS validation
enabled and pass the CA bundle to Node:

```yaml
services:
    iptvnator:
        volumes:
            - ./ca.pem:/etc/ssl/private/provider-ca.pem:ro
        environment:
            NODE_EXTRA_CA_CERTS: /etc/ssl/private/provider-ca.pem
```

The entrypoint renders the nginx config from `docker/nginx.conf`, starts the
backend, waits for `/health`, and only then starts nginx. The nginx config
serves the PWA with SPA fallback, avoids caching `assets/app-config.js`, and
proxies `/api/*` to the internal backend. The Dockerfile and compose file both
define a health check against `/api/health`. If nginx or the backend exits
after startup, the entrypoint exits the container so Docker Compose can apply
the `restart: unless-stopped` policy.

## Local Validation

```bash
pnpm nx test web-backend
pnpm nx build web --configuration=pwa --skip-nx-cache
pnpm nx build web-backend
pnpm nx run web-e2e:e2e -- --project=chromium --grep @self-hosted
docker compose -f docker/docker-compose.yml config
```
