# Embedded MPV for Windows and Linux

## Summary

Add support through three implementation slices:

1. Foundation: extract the shared libmpv session/IPC core from the macOS-only native source and generalize build/runtime/package contracts without enabling new platforms.
2. Windows: add a Windows x64 backend using `HWND` plus mpv `wid`, runtime staging, packaging, and CI verification.
3. Linux: add a Linux x64 X11/Xwayland backend using an X11 `Window` plus mpv `wid`, runtime staging, packaging, and CI verification.

Reuse the current Angular UI, IPC bridge, `EmbeddedMpvSession` contract, Settings support probe, polling/session logic, recording path logic, and E2E infrastructure. The main work is native addon structure, runtime tooling, package verification, and GitHub Actions.

## Key Changes

- Split `apps/electron-backend/native/src/embedded_mpv.mm` into shared C++ session/event/command code plus platform backends.
- Keep macOS render backend behavior unchanged.
- Add Windows x64 and Linux x64 platform backends while preserving existing N-API exports.
- Generalize `vendor/embedded-mpv/<platform>-<arch>/` beyond `darwin-*`, adding `win32-x64` and `linux-x64`.
- Replace macOS-only build/stage helpers with cross-platform helpers, keeping macOS script names as compatibility wrappers.
- Bundle only LGPL-compatible dynamic runtimes with manifests; release builds reject system-package/Homebrew-style runtime origins.
- Update `electron-builder.json` to unpack/copy `.node`, `.dylib`, `.dll`, `.so`, `.so.*`, and runtime manifests.
- Extend package layout verification for macOS, Windows, and Linux.
- Keep existing renderer IPC shape; `EmbeddedMpvSupport.platform` may now report `win32` or `linux`.
- Show Embedded MPV in Settings on Windows/Linux only when `getEmbeddedMpvSupport()` reports `supported: true`.
- Extend `.github/workflows/build-and-make.yaml` with platform/arch-aware embedded MPV cache keys and runtime build/stage steps.

## Test Plan

- `pnpm nx test electron-backend`: platform support matrix, missing runtime reasons, addon candidate paths, recording/session behavior after native split.
- `pnpm nx test web`: Settings option visibility for `darwin`, `win32`, `linux`, unsupported arch, and unsupported Wayland.
- `pnpm nx test ui-playback`: embedded player capability-driven controls remain stable.
- `pnpm nx test packaging`: `electron-builder.json`, `asarUnpack`, runtime manifest, and package layout checks for `.dll`/`.so`.
- `pnpm nx run electron-backend:build-embedded-mpv` on macOS, Windows x64, and Linux x64.
- `pnpm run build:backend`.
- `pnpm run verify:package-layout -- macos <arch>`, `-- windows x64`, and `-- linux x64`.
- Extend `electron-backend-e2e:e2e-ci--src/settings.e2e.ts`.
- For supported OSes, run Electron with CDP port `9222` and verify with `agent-browser --cdp 9222 tab`, `snapshot -i`, and `screenshot`.

## Assumptions

- v1 supports Windows x64 and Linux x64 X11/Xwayland only.
- Linux native Wayland support is out of scope for these PRs because Electron and mpv embedding both have platform limitations there.
- Existing macOS behavior must not regress.
