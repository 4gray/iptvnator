# Testing selective Xtream catalogs on Linux

This is a development build for issue #1965, not a released IPTVnator version.
Use an isolated profile, not your normal application data.

## Build

From a checkout of the pull-request branch:

```bash
# Use the Node version in .nvmrc (for example, fnm install && fnm use).
corepack pnpm install --frozen-lockfile
corepack pnpm run build:backend
```

The repository pins pnpm through `packageManager`. The backend build also
builds the renderer and database worker. Linux native dependencies follow the
normal repository build; this feature does not require embedded MPV playback.

## Run without touching the regular profile

```bash
ELECTRON_IS_DEV=0 \
IPTVNATOR_E2E_DATA_DIR="$HOME/.local/share/iptvnator-dev/xtream-selection" \
  corepack pnpm exec electron dist/apps/electron-backend/main.js --ozone-platform=x11
```

Close a previous development instance before launching again. `ELECTRON_IS_DEV=0`
loads the built frontend instead of requesting a development server on port 4200.
The X11 flag uses Xwayland on a Wayland desktop and avoids the Wayland/Vulkan
conflict reported by some Linux graphics configurations.

The existing test-profile override redirects SQLite, Electron user data, and
settings into this separate directory. Reuse it across launches to test
persistence. Do not point it at `~/.iptvnator` or your usual Electron profile.
Do not run two development instances against the same test directory.

Add a source manually, or import a backup into the development instance only.
A backup containing passwords is sensitive: do not commit or attach it to an
issue. The normal app's downloaded files are not copied into this profile;
verify download preservation using a development-profile download instead.

## Manual checks

- Add a source with only Live TV selected; verify Movies and Series are not
  imported. Compare import time against all three types on the same provider.
- Edit that source to enable Movies. Saving shows the scanning popup and loads
  Movies without refreshing Live TV. The popup identifies Movies, shows remote
  loading and local save progress, then closes when done. Repeat with Series;
  already enabled types should not refresh. Reopen Edit to confirm the selection.
- Favorite a movie, play it to create history/progress, and optionally download
  it. Disable Movies. It disappears from browsing/search, but its Favorites and
  history entries remain visible with a disabled-type status and remain usable.
- Refresh with Movies disabled. Verify its saved entries, playback progress and
  downloaded file remain intact; they must not trigger a full movie-catalog
  refresh. Individual detail/episode/playback requests remain allowed.
- Disable all types. The source remains saved; refreshing makes no category or
  catalog requests. Re-enable one type and verify it refreshes even when cached.
- Restart and export/import a backup to confirm the selection survives, including
  the all-disabled case. Older backups without a selection enable all types.

## Automated checks

The Electron E2E test uses a loopback recording proxy to assert which category
and catalog actions the real desktop process sends. It never records credentials.
The SQLite regression uses Electron's native SQLite and foreign keys enabled.

```bash
pnpm nx run electron-backend-e2e:e2e-ci--src/xtream-content-selection.e2e.ts
pnpm nx test portal-xtream-data-access --runInBand
pnpm nx test electron-backend --runInBand --testPathPatterns=xtream-content-selection
pnpm nx test services --runInBand --testPathPatterns='xtream-selected-catalog-refresh|playlist-backup.service'
```

The composed E2E target invokes `pnpm` in child processes, so it must be on PATH
(`corepack enable pnpm` if your installation does not already provide it).
