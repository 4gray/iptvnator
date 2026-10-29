# Self-hosted IPTVnator

User-facing overview with quick start, variables and FAQ:
<https://4gray.github.io/iptvnator/download/docker/>. This file is the
reference behind it.

The self-hosted image contains both pieces required for the browser PWA:

- Angular PWA static files served by nginx
- The monorepo `web-backend` Express app proxied under `/api`

The historical standalone `4gray/iptvnator-backend` image is no longer needed
for the default Docker deployment.

## PWA Limitations And Playback Troubleshooting

The Docker image runs the browser PWA, not the Electron desktop application.
That means:

- EPG/XMLTV panels and multi-EPG views are not available in the self-hosted PWA.
- With server storage enabled, source definitions are shared by connected PWA
  and Electron clients. Each browser retains a local IndexedDB projection and
  its own Xtream user data. Viewing activity is not synchronized.
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
| `IPTVNATOR_STORAGE`                      | `server` in the image   | `server` opens the server storage database under `IPTVNATOR_DATA_DIR` and its `/api/v1` routes; `none` keeps the backend stateless.          |
| `IPTVNATOR_DATA_DIR`                     | `/data` in the image    | Data root; the database is `<root>/databases/iptvnator.db`. Mount a volume here.                                                             |
| `IPTVNATOR_ACCESS_TOKEN`                 | unset                   | Optional shared access token. Enter it in the client connection UI; all non-public API and provider proxy routes require it. |
| `IPTVNATOR_MAX_DOCUMENT_MB`              | `64`                    | Largest playlist document the backend accepts. Keep the nginx `client_max_body_size` in step.                                                |
| `IPTVNATOR_BACKEND_START_TIMEOUT`        | `300`                   | Seconds the entrypoint waits for the backend's `/health` before giving up. Database migrations run before the backend listens.              |

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

## Server Storage

The image opens a server storage database on the `/data` volume
(`IPTVNATOR_STORAGE=server`, `IPTVNATOR_DATA_DIR=/data`) and serves its API
under `/api/v1`. Source definitions are shared between devices connected to
that instance. Open the NAS web address on phones/tablets, or use Settings →
Data → Server in Electron to enter the same app address. Names, connections
and uploaded M3U text synchronize; favorites, history, playback positions and
EPG remain local. Visible clients refresh within a 15-second polling interval.

Settings → Server can preview and import the device's original local sources.
Matching connections are deduplicated; the original library is retained.
Disconnecting returns to that library without removing sources from NAS.
Connection changes restart/reload the client. A previously synchronized client
keeps its cached sources while offline; shared source edits require the server.

For Synology, mount a persistent folder or named volume at `/data`, retain its
write permissions, and expose the app port through your existing NAS network or
reverse proxy. Use a container-capable NAS and an image matching its CPU
architecture. Set `CLIENT_URL` to the actual browser origin. Keep an HTTPS
reverse proxy and a trusted certificate for browser installation/secure-context
features; plain HTTP LAN access is not equivalent to an installable PWA.
Manually entered client addresses accept the app's reverse-proxy subpath;
`https://nas.example/iptvnator` selects `/iptvnator/api`.

Provider credentials will be stored unencrypted in that database, as the
desktop app does. Protect externally accessible instances with the shared token
or reverse-proxy authentication. Browser tokens last for the tab; desktop uses
OS-protected storage where available and otherwise asks again after restart.
Back up the volume like any database: stop the container, or copy
`databases/iptvnator.db` together with its `-wal` file.

## IPv6, VPNs, And Connection Fallback

Node races IPv6 and IPv4 addresses when a provider hostname has both ("happy
eyeballs"), and its stock per-attempt budget of 250 ms is too short for many
VPN and container networks. The classic symptom is a provider that answers
`wget` from inside the container but fails in IPTVnator with
`Bad Gateway (ETIMEDOUT)` — typically behind an IPv4-only VPN namespace such
as Gluetun/WireGuard, where the IPv6 route is unreachable and the working
IPv4 handshake needs more than 250 ms.

The backend therefore raises the per-attempt connection budget to 2500 ms at
startup. This keeps the IPv6→IPv4 fallback fully automatic in both
directions. If you pass
`--network-family-autoselection-attempt-timeout` yourself through
`NODE_OPTIONS`, your value wins and the backend leaves it untouched.

If a provider still fails, check the container logs first: outbound provider
failures are logged with the target hostname and the underlying Node error
codes (`ETIMEDOUT`, `ENETUNREACH`, `ENOTFOUND`, ...), and the same code is
returned to the app in the error message. As a last resort you can pin the
legacy behavior entirely:

```yaml
services:
    iptvnator:
        environment:
            # Disables IPv6/IPv4 racing completely; only for networks where
            # IPv6 can never work. Breaks IPv6-only deployments.
            NODE_OPTIONS: '--dns-result-order=ipv4first --no-network-family-autoselection'
```

## Local Validation

```bash
pnpm nx test web-backend
pnpm nx build web --configuration=pwa --skip-nx-cache
pnpm nx build web-backend
pnpm nx run web-e2e:e2e -- --project=chromium --grep @self-hosted
docker compose -f docker/docker-compose.yml config
```
