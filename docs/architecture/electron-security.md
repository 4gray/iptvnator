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
