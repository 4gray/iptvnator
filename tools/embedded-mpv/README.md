# Embedded MPV Runtime

This directory owns the source builders, staging, manifests, and archive
helpers for IPTVnator's experimental Embedded MPV runtime.

The Linux architecture has a strict process boundary:

- Electron, `embedded_mpv.node`, and `embedded_mpv_frame_reader.node` must not
  load or link libmpv.
- Native-view starts a separate system `mpv --wid` process.
- Frame-copy starts `iptvnator_mpv_helper`; only that helper may link libmpv.

Do not weaken this boundary to simplify packaging. A missing helper/runtime
must make frame-copy unavailable and leave native-view as the safe x64
fallback.

## Runtime Policy

Release builds use an LGPL-compatible, dynamically linked runtime:

- FFmpeg is built without `--enable-gpl` and `--enable-nonfree`.
- mpv is built with `-Dlibmpv=true` and `-Dgpl=false`.
- Bundled libraries remain individually replaceable under `native/lib`.
- Exact source URLs, versions, checksums or git commits, submodules, licenses,
  build flags, local patches, and build scripts are published with the release.

Homebrew mpv is local-development-only. It requires
`IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW=1`, and release validation rejects it.

## Generated Layout

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
    lib/libmpv-2.dll        # accepted basename variants are preserved
    lib/libmpv.dll.a        # or an MSVC import library
    runtime-manifest.json
  linux-x64/
    include/mpv/client.h
    lib/libmpv.so
    lib/libmpv.so.2
    lib/<declared closure>
    notices/embedded-mpv-notices.json
    notices/THIRD_PARTY_NOTICES.txt
    notices/licenses/<package>/<upstream path>
    runtime-manifest.json
```

These directories are generated release inputs and are ignored by git.
`runtime-manifest.json` is the profile-neutral source/build manifest. Packaging
writes a normalized `embedded-mpv-runtime.json` beside the native artifacts.
Bundled Linux profiles flatten the three notice entries from `notices/` into
that same native directory; system and marker-only profiles remove them.

## Building And Staging

Stage an existing compatible prefix with:

```bash
pnpm embedded-mpv:stage-runtime -- darwin arm64 /path/to/prefix
pnpm embedded-mpv:stage-runtime -- darwin x64 /path/to/prefix
pnpm embedded-mpv:stage-runtime -- win32 x64 /path/to/prefix
pnpm embedded-mpv:stage-runtime -- linux x64 /path/to/prefix
```

Build the pinned macOS or Linux source runtime first when no prefix exists:

```bash
pnpm embedded-mpv:build-runtime -- arm64 /tmp/macos-prefix
pnpm embedded-mpv:stage-runtime -- darwin arm64 /tmp/macos-prefix

pnpm embedded-mpv:build-runtime:linux -- /tmp/linux-prefix
pnpm embedded-mpv:stage-runtime -- linux x64 /tmp/linux-prefix
```

The Linux builder runs only on Linux x64. It requires the tool versions and
system development interfaces declared in `build-linux-runtime.cjs`, including
Meson 1.6 or newer, gperf 3.1 or newer, Ninja, CMake, NASM, pkg-config,
patchelf, and `readelf`.
It builds into an owned staging directory and publishes atomically, so it will
not delete or overwrite an arbitrary destination.

The pinned Linux source stack currently includes FFmpeg 8.1, mpv 0.41.0,
libplacebo 7.360.1, libass 0.17.3, FreeType 2.13.3, FriBidi 1.0.16,
HarfBuzz 8.5.0, Expat 2.8.2, Fontconfig 2.16.0, OpenSSL 3.5.7, hwdata
0.409, and libdisplay-info 0.1.1. The builder stages a private pinned
`pnp.ids`/`hwdata.pc`; libdisplay-info is not allowed to consume the build
host's `/usr/share/hwdata`.

Before publication, the Linux builder verifies:

- every archive digest and git/submodule commit;
- the exact FFmpeg/mpv flags and LGPL policy;
- an exact `libmpv.so.2` SONAME and complete reachable shared-library closure;
- `$ORIGIN` RUNPATHs with no build-prefix paths or undeclared host fallback;
- the external system-library allowlist;
- `GLIBC_2.35` and `GLIBCXX_3.4.30` ABI ceilings;
- file hashes, byte sizes, build inputs, licenses, and source obligations.

## Linux Package Profiles

Set one exact `IPTVNATOR_LINUX_FRAME_COPY_PROFILE` per packaging pass:

| Profile    | Formats          | Runtime handling                                             |
| ---------- | ---------------- | ------------------------------------------------------------ |
| `system`   | DEB, RPM, Pacman | Remove `native/lib`; require `libmpv2`, `mpv-libs`, or `mpv` |
| `portable` | AppImage, Snap   | Retain the pinned LGPL closure under `native/lib`            |
| `flatpak`  | Flatpak          | Retain the same pinned LGPL closure under `native/lib`       |

The DEB metadata requires `libmpv2` and is release-tested on Ubuntu 24.04
(Noble). Ubuntu 22.04 (Jammy) only provides `libmpv1`; use the x64 AppImage on
that distribution rather than relaxing the runtime contract.

The strict Snap retains Electron Builder's default plugs and adds an
auto-connected private `shared-memory` plug. This supplies a snap-specific
POSIX shm namespace without granting global cross-snap shared-memory access.

The bounded probe and every playback helper share one sanitized loader
environment derived from the validated, cached runtime mode. Ambient
`LD_PRELOAD` and `LD_LIBRARY_PATH` are removed. System packages then use the
default loader; bundled packages put their validated `native/lib` first.
AppImage and Flatpak use normal host/sandbox lookup for the declared external
interfaces. In a genuine Snap mount, filtered `SNAP_LIBRARY_PATH` GL roots
under `/var/lib/snapd/lib/gl` come next, ahead of generic `$SNAP` library and
x64 multiarch roots, so host GL/NVIDIA dispatch cannot be shadowed by
snap-staged generic GL libraries. A Linux session without the validated cached
mode is rejected before spawn.

Profiles cannot share one Electron Builder pass because its targets reuse the
same unpacked application directory. A missing or unsupported profile, or a
target from another profile, fails packaging.

Linux frame-copy release artifacts are x64-only. Non-x64 packages are always
marker-only even if environment variables point at the x64 staged runtime.

## Build Integration

`apps/electron-backend/build-embedded-mpv.js` builds the addon, frame reader,
and helper against the staged inputs. On Linux it links the helper to the
verified staged libmpv path rather than a generic host `-lmpv`, then checks
with `readelf` that:

- the helper has exactly the declared libmpv `DT_NEEDED`;
- the helper RUNPATH is `$ORIGIN/lib`;
- the addon and frame reader have no libmpv dependency;
- no runtime dependency contains an absolute/build-prefix loader path.

The package hook copies native artifacts into
`app.asar.unpacked/electron-backend/native/`, selects the system or bundled
layout, restores exact file modes, writes the packaged manifest, and validates
the bundled legal payload. AppImage, Snap, and Flatpak receive
`embedded-mpv-notices.json`, `THIRD_PARTY_NOTICES.txt`, and
`licenses/<package>/**`; DEB, RPM, Pacman, and marker-only packages must not
retain them. Package validation also scans the Electron executable and all
shipped Electron libraries for a direct libmpv dependency.

At startup, Linux x64 frame-copy is advertised only after the main process
validates that manifest/files and successfully executes:

```bash
iptvnator_mpv_helper --runtime-probe
```

The bounded probe initializes idle libmpv plus EGL/OpenGL and mpv render
contexts, then creates, maps, validates, and destroys a minimal `16x16`
shared-memory ring named `/impv-fc-runtime-probe-<pid>`. It does not open media
or enter media/command loops. A timeout, loader failure, malformed protocol,
missing file, hash mismatch, unusable graphics path, or shm lifecycle failure
returns a stable reason and keeps the BrowserWindow sandbox enabled. The
installed-Snap probe therefore tests the private shared-memory confinement
needed by playback rather than only loader and graphics startup.

## CI And Source Distribution

Linux CI builds or restores the pinned source runtime once, then packages and
verifies `system`, `portable`, and `flatpak` independently. Every artifact is
extracted for manifest, mode, package-metadata, ELF-isolation, and helper-probe
checks. System formats are probed after their declared dependency is installed;
Snap and Flatpak also require a sandboxed probe where the runner supports it.

The Linux runtime cache contains only staged headers/libraries/manifest plus
immutable source inputs: exact downloaded archives (including hwdata), a clean
recursive libplacebo checkout, and collected license files. It never caches
finished notices or the compliance tarball. After either a build or cache hit,
CI revalidates those inputs, regenerates `vendor/embedded-mpv/linux-x64/notices`
for the current runtime manifest, and creates
`linux-frame-copy-runtime-sources.tar.xz` for the current repository
revision/diff. Before archiving, the clean cached libplacebo checkout is
converted into a non-dereferenced working-tree snapshot with every `.git`
entry removed; the validated main/submodule commits remain in the source
index.

That source-compliance archive uses normalized tar metadata and contains the
exact unique archive hash set, VCS-free libplacebo sources and recursive
submodules, license inputs, generated notices, runtime/source index metadata,
and the builder, stager, manifest, notice-generator, and source-snapshot code.
The notice generator rejects missing, undeclared, symlinked, size-mismatched,
or hash-mismatched license files.

Snap publication is a separate `release.published` workflow for public `v*`
GitHub releases. It verifies that the public release already contains at least
one Snap and exactly one non-empty
`linux-frame-copy-runtime-sources.tar.xz` before uploading anything. The
workflow uploads only to the Store's edge channel.
Candidate/stable promotion is manual after installed-Snap frame-copy and
missing-runtime fallback smoke; GitHub Actions never promotes automatically.

Windows CI stages a checksum-pinned x64 LGPL archive. The DLL basename encoded
in its import library is preserved and must be present beside
`iptvnator_mpv_helper.exe`. Tagged releases require explicit repository
configuration; the public fallback is for non-tag artifacts only.

## Local Development

Linux can use distribution development packages for an unshipped local build
(`libmpv-dev`, EGL/OpenGL/GBM development files, and X11 headers). Overrides:
`LIBMPV_INCLUDE_DIR` and `LINUX_NATIVE_LIBRARY_DIR`. Required/release package
builds must use the pinned staged runtime and manifest.

On macOS:

```bash
pnpm run serve:backend:embedded-mpv
```

This explicitly permits Homebrew for the local native build and enables the
experiment. It is not a release path.

See `docs/architecture/embedded-mpv-native.md` for the runtime capability,
fallback, controls, and packaged-release contracts.
