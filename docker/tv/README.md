# TV companion backend

This optional development deployment adds the matching TV API and phone setup
alongside an existing self-hosted IPTVnator. It never mounts the existing database.
`/api` serves the new TV backend; `/library/v1` forwards only GET/PUT/OPTIONS to the
existing library API. Its server token passes through unchanged. CORS allows the
packaged TV origin, `null` for webOS file origins and the configured web origin.
Access logging is disabled because provider requests can carry credentials.
This is a trusted-LAN deployment; do not expose the unauthenticated TV proxy to
the Internet. It is not a media relay or an Electron synchronization feature.

Build with the repository Node/pnpm versions:

```sh
pnpm nx build web-backend
mkdir -p dist/tv-nas/build/web-backend
cp -R dist/apps/web-backend/. dist/tv-nas/build/web-backend/
cp docker/tv/Dockerfile docker/tv/nginx.conf docker/tv/start.sh dist/tv-nas/build/
docker build --platform linux/amd64 -t iptvnator-tv:0.1.9 dist/tv-nas/build
```

The base is the existing published self-hosted runtime, with its matching native
SQLite module. The TV backend runs with storage disabled; the original container
remains the only owner of its database. Validate a changed base image before use.
The amd64 build is for an x86 Synology; do not install it on an ARM NAS.

Prepare `image.tar` using `docker save`, and copy `compose.yaml`, `install.sh` and
an `.env` next to it. The environment names an existing Docker network and service:

```dotenv
LIBRARY_NETWORK=iptvnator_default
LIBRARY_UPSTREAM=http://iptvnator/api
TV_WEB_ORIGIN=http://nas.fritz.box:4335
```

Use trusted deployment values. Generate `SHA256SUMS` over the archive, Compose,
installer and `.env`. On the NAS, review these files and run `sudo sh install.sh`.
The installer checks hashes before loading the image and starts only the separate
`iptvnator-tv` Compose project. Its restart policy is `unless-stopped`. No registry
push, existing-service restart or database migration is part of this installation.

Check `/api/tv/connection` and `/library/v1/instance` before changing TV settings.
On TV, set Backend URL to `http://nas.fritz.box:4335/api` and Library server URL to
`http://nas.fritz.box:4335/library`. Enter the existing server token if required.
A compatible single self-hosted build can instead supply both at the same `/api`
URL, once the existing service is deliberately upgraded.

Rollback: disconnect the server library on TV (downloaded sources stay local),
restore the previous backend URL, then run `docker compose down` in this companion
project. Do not run it in the existing IPTVnator project. The original PWA and data
volume remain independent.
