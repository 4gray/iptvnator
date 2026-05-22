# Embedded MPV macOS Runtime

This folder contains tooling for preparing the macOS `libmpv` runtime that is bundled with IPTVnator's experimental embedded MPV player.

## Runtime Policy

Release builds must use an LGPL-compatible runtime:

- FFmpeg must be built without `--enable-gpl` and without `--enable-nonfree`.
- mpv must be built with `-Dlibmpv=true` and `-Dgpl=false`.
- The runtime must be dynamically linked so users can inspect and replace LGPL libraries.
- The exact source URLs, versions, build flags, local patches, and checksums must be published with the release.

Do not ship the Homebrew `mpv` runtime. It is acceptable only for local development when `IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW=1` is set, and release packaging rejects it.

## Expected Layout

The native addon build consumes:

```text
vendor/embedded-mpv/
  darwin-arm64/
    include/mpv/client.h
    lib/*.dylib
    runtime-manifest.json
  darwin-x64/
    include/mpv/client.h
    lib/*.dylib
    runtime-manifest.json
```

The generated `lib/` and `include/` directories are release inputs, not source files. They are ignored by git by default.

## Staging A Built Runtime

After building an LGPL-compatible prefix for one architecture, stage it with:

```bash
node tools/embedded-mpv/stage-macos-runtime.mjs arm64 /path/to/lgpl-prefix
node tools/embedded-mpv/stage-macos-runtime.mjs x64 /path/to/lgpl-prefix
```

The prefix must contain `include/mpv/client.h`, `lib/libmpv.2.dylib` or `lib/libmpv.dylib`, and all non-system dylib dependencies required by `libmpv`.

If the prefix contains `runtime-manifest.json`, the staging script copies its build metadata into the vendored manifest. At minimum, record:

- FFmpeg version, source URL, checksum, configure flags, and patches
- mpv version, source URL, checksum, Meson flags, and patches
- source-distribution URL for the corresponding release

## Building The CI Runtime

Tagged macOS release builds build the runtime from pinned source archives before `electron-backend:build`. The workflow can also enable this path temporarily for macOS PR artifact testing:

```bash
pnpm embedded-mpv:build-runtime -- arm64 /tmp/embedded-mpv-prefix
pnpm embedded-mpv:stage-runtime -- arm64 /tmp/embedded-mpv-prefix
```

During temporary PR and `master` artifact testing, CI restores an exact-keyed GitHub Actions cache for the staged `vendor/embedded-mpv/darwin-<arch>/` runtime before falling back to the source build. The cache key includes the target architecture, macOS deployment target, Xcode version, and hashes of the runtime build/staging scripts. Cache entries are saved only from trusted repository refs and are treated strictly as a speed optimization; tagged release builds continue to rebuild from pinned sources unless a future signed and attested runtime artifact flow is introduced.

The builder currently pins:

- FFmpeg `8.1`, configured without `--enable-gpl` or `--enable-nonfree`, and with autodetected external libraries disabled
- mpv `0.41.0`, configured with `-Dlibmpv=true -Dgpl=false`
- libplacebo `7.360.1`, checked out from git with the `glad`, Python template, `fast_float`, and `Vulkan-Headers` submodules required by its Meson build
- libass `0.17.3` plus FreeType, FriBidi, and HarfBuzz

The build manifest records source URLs, downloaded archive SHA-256 values where applicable, libplacebo git commit/submodule metadata, and the exact FFmpeg/mpv flags. The staged manifest is normalized to `origin: vendored-lgpl`, which is the only embedded MPV runtime origin allowed in required macOS release packaging.

## Build Integration

`apps/electron-backend/build-embedded-mpv.js` links the native addon against the staged runtime, copies dylibs into `apps/electron-backend/native/build/Release/lib/`, rewrites Mach-O paths to `@loader_path`, and writes `embedded-mpv-runtime.json`.

For local macOS development with Homebrew `mpv`, use:

```bash
pnpm run serve:backend:embedded-mpv
```

The script rebuilds the native addon with `IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW=1` before starting Electron with the experimental player enabled. Use this only for local testing; release packaging rejects the resulting `homebrew-dev` runtime manifest.

The macOS `afterPack` hook copies `dist/apps/electron-backend/native/` into `app.asar.unpacked/electron-backend/native/` so the addon, runtime manifest, dylibs, and non-`.dylib` Mach-O runtime files are available as real files. Linux and Windows artifacts do not include that native directory.

During release packaging, `tools/packaging/electron-after-pack.cjs` verifies that the packaged app uses a `vendored-lgpl` runtime and has no `/opt/homebrew` or `/usr/local` dynamic links for embedded MPV.

Set `IPTVNATOR_REQUIRE_EMBEDDED_MPV=1` when packaging a macOS release artifact that must include Embedded MPV. The same variable is temporarily enabled for macOS PR and `master` push artifacts while the bundled runtime is being tested. After manual artifact validation, remove the workflow's PR and `refs/heads/master` conditions so PR and non-tag development builds leave the variable unset or `0` and can package without a staged runtime while Settings keeps Embedded MPV hidden.
