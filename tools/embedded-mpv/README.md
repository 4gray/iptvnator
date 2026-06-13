# Embedded MPV Runtime

This folder contains tooling for preparing MPV runtime/build inputs for IPTVnator's experimental embedded MPV player. macOS and Windows bundle `libmpv`; Linux uses staged MPV headers for compilation and launches the system `mpv` executable at runtime.

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
  win32-x64/
    include/mpv/client.h
    lib/mpv-2.dll
    lib/mpv.lib
    runtime-manifest.json
  linux-x64/
    include/mpv/client.h
    runtime-manifest.json
```

The generated `lib/` and `include/` directories are release inputs, not source files. They are ignored by git by default.

## Staging A Built Runtime

After building an LGPL-compatible prefix for one platform/architecture, stage it with:

```bash
pnpm embedded-mpv:stage-runtime -- darwin arm64 /path/to/lgpl-prefix
pnpm embedded-mpv:stage-runtime -- darwin x64 /path/to/lgpl-prefix
pnpm embedded-mpv:stage-runtime -- win32 x64 /path/to/lgpl-prefix
pnpm embedded-mpv:stage-runtime -- linux x64 /path/to/lgpl-prefix
```

For compatibility, the legacy macOS-only staging command is still available:

```bash
pnpm embedded-mpv:stage-runtime:macos -- arm64 /path/to/lgpl-prefix
pnpm embedded-mpv:stage-runtime:macos -- x64 /path/to/lgpl-prefix
```

The prefix must contain `include/mpv/client.h` and the platform runtime/build files:

- macOS: `lib/libmpv.2.dylib` or `lib/libmpv.dylib` plus all non-system dylib dependencies
- Windows: `lib/mpv.lib` or `lib/mpv-2.lib`, and `bin/mpv-2.dll` or `lib/mpv-2.dll`
- Linux: `include/mpv/client.h`; CI also records the `libmpv-dev` and `mpv` package versions used as build inputs. Linux runtime playback uses the system `mpv` executable and does not bundle `libmpv.so`.

If the prefix contains `runtime-manifest.json`, the staging script copies its build metadata into the vendored manifest. At minimum, record:

- FFmpeg version, source URL, checksum, configure flags, and patches
- mpv version, source URL, checksum, Meson flags, and patches
- source-distribution URL for the corresponding release

## Building The CI Runtime

Tagged macOS release builds build the runtime from pinned source archives before `electron-backend:build`. The workflow can also enable this path temporarily for macOS PR artifact testing:

```bash
pnpm embedded-mpv:build-runtime -- arm64 /tmp/embedded-mpv-prefix
pnpm embedded-mpv:stage-runtime -- darwin arm64 /tmp/embedded-mpv-prefix
```

Linux CI does not build libmpv from source. It installs Ubuntu runner packages
(`libmpv-dev` and `mpv`), stages their headers and build metadata under
`vendor/embedded-mpv/linux-x64/`, and requires the native addon/package layout
to be present. Linux playback does not load or bundle `libmpv` in the Electron
process; the addon creates an X11 child window and starts a system `mpv --wid`
process at runtime.

During temporary PR and `master` artifact testing, CI restores an exact-keyed GitHub Actions cache for the staged `vendor/embedded-mpv/<platform>-<arch>/` runtime before falling back to the macOS source build where available. The cache key includes the target platform, architecture, macOS deployment target, Xcode version when available, and hashes of the runtime build/staging scripts. Cache entries are saved only from trusted repository refs and are treated strictly as a speed optimization; tagged macOS release builds continue to rebuild from pinned sources unless a future signed and attested runtime artifact flow is introduced.

The builder currently pins:

- FFmpeg `8.1`, configured without `--enable-gpl` or `--enable-nonfree`, and with autodetected external libraries disabled
- mpv `0.41.0`, configured with `-Dlibmpv=true -Dgpl=false`
- libplacebo `7.360.1`, checked out from git with the `glad`, Python template, `fast_float`, and `Vulkan-Headers` submodules required by its Meson build
- libass `0.17.3` plus FreeType, FriBidi, and HarfBuzz

The build manifest records source URLs, downloaded archive SHA-256 values where applicable, libplacebo git commit/submodule metadata, and the exact FFmpeg/mpv flags. The staged macOS/Windows manifest is normalized to `origin: vendored-lgpl`, which is the only embedded MPV runtime origin allowed in required macOS/Windows release packaging.

## Build Integration

`apps/electron-backend/build-embedded-mpv.js` builds the native addon against the staged runtime/build inputs, copies macOS/Windows runtime libraries into `apps/electron-backend/native/build/Release/lib/`, rewrites macOS Mach-O paths to `@loader_path`, and writes `embedded-mpv-runtime.json`. Linux builds use the staged MPV headers and system X11 development libraries, write an `external-mpv-process` manifest, and must not copy or link directly to `libmpv`; CI validates this with package checks and `ldd`.

For local macOS development with Homebrew `mpv`, use:

```bash
pnpm run serve:backend:embedded-mpv
```

The script rebuilds the native addon with `IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW=1` before starting Electron with the experimental player enabled. Use this only for local testing; release packaging rejects the resulting `homebrew-dev` runtime manifest.

The `afterPack` hook copies `dist/apps/electron-backend/native/` into `app.asar.unpacked/electron-backend/native/` so the addon, runtime manifest, and runtime libraries are available as real files where needed. Linux packages include the addon and manifest, but no bundled `libmpv.so`.

During release packaging, `tools/packaging/electron-after-pack.cjs` verifies that macOS/Windows packages use a `vendored-lgpl` runtime/build input set. macOS artifacts additionally verify that Mach-O dependencies have no `/opt/homebrew` or `/usr/local` dynamic links for embedded MPV. Linux artifacts verify that the addon and `external-mpv-process` manifest are present, that no bundled `libmpv.so` files are present, and the runtime support check verifies that `mpv` is available on `PATH`.

Set `IPTVNATOR_REQUIRE_EMBEDDED_MPV=1` when packaging a release artifact that must include Embedded MPV. The same variable is temporarily enabled for macOS PR and `master` push artifacts while the bundled runtime is being tested. Linux CI packaging requires Embedded MPV after staging the Ubuntu package build inputs. Windows CI packaging requires Embedded MPV when an exact-keyed staged runtime cache is restored; otherwise the Windows job builds without the native addon and Settings keeps Embedded MPV hidden.

## Platform Notes

- macOS keeps the existing libmpv render-context backend because mpv `wid` stays black inside Electron on macOS.
- Windows uses an embedded child `HWND` and passes it to mpv through `wid`.
- Linux uses an X11 child window and starts a system `mpv --wid` process for that window. Native Wayland is not supported in v1; run under X11/Xwayland so `DISPLAY` is set and `mpv` can honor the X11 window id.
