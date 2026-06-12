# Electron Security Contract

This document records the Electron runtime security contract for the desktop app.

## BrowserWindow Defaults

The main window is created in `apps/electron-backend/src/app/app.ts` with an
explicit hardened `webPreferences` object:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`
- `preload: apps/electron-backend/src/app/api/main.preload.ts`

Renderer code must use the preload bridge exposed as `window.electron`.
Do not re-enable direct Node.js access from Angular code. New desktop-only APIs
should be added to the preload bridge and backed by an `ipcMain.handle(...)`
owner in the Electron backend.

## Preload API Type Contract

The canonical renderer bridge type is
`libs/shared/interfaces/src/lib/electron-api.interface.ts`.

Keep these surfaces in sync when adding or changing a preload method:

1. `ElectronBridgeApi` in `@iptvnator/shared/interfaces`
2. `apps/electron-backend/src/app/api/main.preload.ts`
3. the owning `ipcMain.handle(...)` event module
4. renderer capability checks or runtime bridge services that consume the method

`global.d.ts` and `apps/web/src/typings.d.ts` should reference
`ElectronBridgeApi` instead of redeclaring `window.electron` method lists.
`main.preload.ts` is typed as `ElectronBridgeApi`, so missing or extra preload
methods fail typecheck instead of silently drifting from renderer typings.

## Navigation And External URLs

The main window owns three navigation gates:

- `setWindowOpenHandler` denies every new window. `http:` and `https:` targets
  are opened in the operating system browser through `shell.openExternal`.
- `will-navigate` allows only the trusted renderer URL. Development mode allows
  `http://localhost:4200`, `http://127.0.0.1:4200`, and `http://[::1]:4200`.
- `will-redirect` applies the same allow/deny rules so server-side redirects
  cannot move the app window to an untrusted origin.

Packaged mode allows only the app's resolved `index.html` renderer file, not
arbitrary `file:` URLs. External web navigations are denied in the app window
and opened in the operating system browser.

Do not add broad protocol allow-lists for renderer navigation. If a new
desktop-only flow needs to open a URL outside IPTVnator, route it through the
default browser unless the app window is deliberately meant to host that URL.

## Content Security Policy

The Angular shell defines a baseline CSP in `apps/web/src/index.html`.

The policy keeps the application self-hosted for scripts, blocks object and
frame embedding, limits forms to the app origin, and allows IPTV playback
sources through `media-src` and `connect-src` for `http:`, `https:`, `blob:`,
and `data:`. The policy keeps `script-src` self-hosted and currently keeps
`unsafe-inline` for existing inline styles.

Angular production builds must not rely on inline event handlers for stylesheet
activation. Keep `web:build:production` and `web:build:pwa` configured without
critical CSS stylesheet deferral (`optimization.styles.inlineCritical: false`)
unless the CSP is intentionally changed and runtime-validated in both Electron
and the self-hosted PWA.

Before tightening either value, validate both Electron development startup and
the PWA/electron build configurations. Playback-heavy changes should also check
that HLS, MPEG-TS, thumbnails, and local file playback are still allowed by the
policy.

## Scoped Request Header Overrides

Inline playback can request temporary `User-Agent`, `Referer`, and `Origin`
header overrides through `window.electron.setUserAgent(userAgent, referer,
scopeUrl)`.

The Electron backend handles that IPC in `apps/electron-backend/src/app/events/shared.events.ts`
and delegates to `apps/electron-backend/src/app/services/request-header-overrides.service.ts`.
The service registers one `session.defaultSession.webRequest.onBeforeSendHeaders`
listener and updates layered in-memory overrides instead of stacking a new
listener for every channel change.

Rules:

- empty playlist-level `userAgent` and `referer` clear all active overrides
- empty channel-level `userAgent` and `referer` with a `scopeUrl` clear only
  the scoped channel override, preserving playlist-level defaults
- channel playback should pass the stream URL as `scopeUrl`
- scoped overrides apply only to the active stream origin and referer origin
- playlist-level user agents and referrers may call the bridge without a
  `scopeUrl`; that is intentionally broader because playlist settings apply to
  the whole M3U playlist
- header names are replaced case-insensitively before canonical `User-Agent`,
  `Referer`, and `Origin` names are written

When changing this flow, keep stale header cleanup covered. Switching from a
channel or playlist with custom headers to one without custom headers must clear
the previous override.

## Main-Process Remote Requests

Renderer-triggered HTTP requests must pass through the URL policy in
`apps/electron-backend/src/app/events/url-safety.ts`. The policy rejects
non-HTTP(S) URLs and embedded credentials, and strict callers also reject
loopback, private, reserved, and DNS-resolved private addresses. IPv4-mapped
IPv6 literals are decoded before classification, including hexadecimal forms
such as `::ffff:7f00:1`, so alternate IPv6 spelling cannot bypass IPv4 rules.

Remote request callers must use the validated Axios redirect helper so every
redirect target is checked before the main process follows it. Under the strict
policy, the helper pins the socket lookup to the IP addresses that passed
validation while retaining the original hostname for TLS SNI, certificate
validation, and virtual hosting. This prevents DNS rebinding between validation
and connection. Callers with custom TLS policy provide a typed agent factory;
the validated request layer supplies the pinned lookup instead of copying
private Node `Agent.options` state. Cross-origin redirects must not forward `Authorization`,
`Cookie`, `Proxy-Authorization`, Axios `params`, or request bodies.

EPG URLs are strict by default because an M3U playlist can supply them through
`url-tvg`. Operators who intentionally use a LAN-hosted EPG source should prefer
the renderer's source-scoped “Allow source” action, which persists the exact EPG
URL in settings and retries that source only. The
`IPTVNATOR_ALLOW_PRIVATE_NETWORK_URLS=1` environment flag remains an
emergency/development process-wide override for strict EPG fetches. Directly
configured Xtream, Stalker, and playlist providers retain private-network
support, but still require HTTP(S), reject embedded credentials, and validate
redirects.

Remote playlist TLS certificates are validated by default. The
renderer can persist a host-scoped invalid-certificate trust decision for a
playlist or EPG source host. The `IPTVNATOR_ALLOW_INSECURE_TLS=1` escape hatch
is only for explicitly trusted providers with invalid or self-signed
certificates when the host-scoped UI path is not available.

## Filesystem Capabilities

Renderer IPC payloads are not filesystem authorization.

- `write-file` accepts only a path returned to the same renderer by the native
  save dialog. The capability is single-use and is consumed before the write,
  including when the filesystem operation fails.
- Download folders are owned by the Electron main process. The OS downloads
  directory is always allowed; a custom directory is accepted only after the
  native folder dialog selects it.
- The selected download directory is persisted under Electron `userData` and
  returned by `DOWNLOADS_GET_DEFAULT_FOLDER`, so renderer-managed settings
  cannot substitute an arbitrary host path.
- Downloads do not overwrite an existing destination file.
- Reveal and playback handlers accept only file paths recorded in IPTVnator's
  downloads database.
