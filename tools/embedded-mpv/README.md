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

| Profile    | Formats          | Runtime handling                                                             |
| ---------- | ---------------- | ---------------------------------------------------------------------------- |
| `system`   | DEB, RPM, Pacman | Remove `native/lib`; require the format-specific system runtime listed below |
| `portable` | AppImage, Snap   | Retain the pinned LGPL closure under `native/lib`                            |
| `flatpak`  | Flatpak          | Retain the same pinned LGPL closure under `native/lib`                       |

The system helper directly links libmpv, EGL, GL, and GBM. Package metadata
therefore declares the full interface set:

- DEB: `libmpv2`, `libegl1`, `libgl1`, `libgbm1`
- RPM: `mpv-libs`, `libglvnd-egl`, `libglvnd-glx`, `mesa-libgbm`
- Pacman: `mpv`, `libglvnd`, `mesa`

The helper links `libGL.so.1` (`-lGL`) rather than `libOpenGL.so.0`; the
former is the direct GL interface supplied by all three system contracts and
Snap's `mesa-core22`.

The DEB metadata is release-tested on Ubuntu 24.04 (Noble). Ubuntu 22.04
(Jammy) only provides `libmpv1`; use the x64 AppImage on that distribution
rather than relaxing the runtime contract. CI explicitly installs the distro
Mesa software renderer for headless smoke. IPTVnator does not add DRI-driver
packages as direct dependencies; any transitive graphics-driver stack remains
under the distro's dependency policy.

The Snap is `base: core22` with strict confinement. It retains Electron
Builder's default plugs and adds an auto-connected private `shared-memory`
plug plus `graphics-core22`, targeting a real empty mode-0755 `$SNAP/graphics`
with external `mesa-core22` as default provider. The graphics provider supplies
EGL/GL/GLX/GBM/DRM/VA, while Electron Builder's exact GNOME content runtime
supplies ALSA/PulseAudio. Neither provider is bundled into IPTVnator's Snap,
source archive, notices, or package-size accounting. The package hook creates
the empty content target because core22 does not synthesize one; the extracted
artifact verifier rejects a missing, redirected, non-empty, or wrongly
permissioned target. Snap metadata must also contain exactly the canonical
graphics-provider layouts: bind `/usr/share/libdrm` from
`$SNAP/graphics/libdrm`, and symlink `/usr/share/drirc.d` to
`$SNAP/graphics/drirc.d`.

The bounded probe and every playback helper share one sanitized loader
environment derived from the validated, cached runtime mode. Ambient
ELF audit/preload/origin/library overrides, direct EGL/GBM/GL/VA/Vulkan paths,
shell startup/options, tracing hooks, exported Bash functions, and
caller-provided architecture triplets are removed or replaced. The
extracted-artifact verifier uses the same deny-set for its direct helper smoke
and preserves feature/debug selectors such as `LIBGL_ALWAYS_SOFTWARE`. System
packages then use the default loader; bundled packages put their validated
`native/lib` first. Packaged addon/helper lookup is package-owned
`app.asar.unpacked` only; cwd/dist candidates are development-only.
AppImage and Flatpak use normal host/sandbox lookup for the declared external
interfaces. Inside the exact packaged Flatpak `/app` context, the helper
reconstructs only Freedesktop Platform 24.08's immutable
`__EGL_EXTERNAL_PLATFORM_CONFIG_DIRS` value; the GL extension's
`add-ld-path` remains available through the sandbox loader cache. Flatpak CI
therefore invokes `flatpak run com.fourgray.iptvnator
--embedded-mpv-runtime-probe` instead of executing the helper around the
application gate. In a genuine Snap mount, filtered `SNAP_LIBRARY_PATH` GL roots
under `/var/lib/snapd/lib/gl` come next, then the fixed x64
`$SNAP/graphics` roots, then exact `$SNAP/gnome-platform` graphics/audio roots,
and finally generic `$SNAP` library roots. The helper rebuilds GBM, GL/VA
driver, EGL vendor/platform, and Vulkan layer variables from those trusted
locations. A Linux session without the validated cached mode is rejected
before spawn.
Both the bounded probe and playback execute through
`$SNAP/graphics/bin/graphics-core22-provider-wrapper`. The graphics mount must
be a real directory and the wrapper a regular, non-symlinked, readable
executable. Otherwise the gate returns the stable
`snap-graphics-provider-unavailable` reason before spawning the helper. The
wrapper child also drops shell startup/options, tracing hooks, and exported
`BASH_FUNC_*` functions, and uses a fixed core22 system `PATH`; ambient Bash
configuration therefore cannot replace the probe before helper execution.

Installed-Snap CI disconnects `graphics-core22`, requires the application-level
diagnostic to emit `snap-graphics-provider-unavailable` and exit with the
controlled status `1`, then reconnects the provider and requires a successful
diagnostic. This keeps the canonical layouts and missing-provider fallback in
the same regression contract.

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
shipped Electron libraries for a direct libmpv dependency. Before target
packaging, that scan is recursive over the pristine Electron tree. After Snap
has merged its template runtime into the payload root, the post-target scan
excludes exactly its package-manager `lib/**` and `usr/lib/**` trees while
remaining recursive everywhere else.

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
application diagnostic retains `helper-probe-failed` as the top-level reason
for nonzero helper exits and adds `helperReason` only when the helper emitted
one exact protocol-v1 line with a fixed allowlisted reason. Its optional
`helperDetail` is restricted to 1–1024 printable ASCII characters; invalid
detail suppresses both helper fields. With `IPTVNATOR_TRACE_PLAYER=1`, non-empty
captured helper stderr is written separately as one JSON-escaped stderr line:
its `stderr` field contains at most the first 16,384 characters and its
`truncated` boolean is always explicit. Empty captures, disabled tracing, and
trace-writer failures do not emit a record or alter availability. The
installed-Snap probe therefore tests the private shared-memory confinement
needed by playback rather than only loader and graphics startup.
Packaging CI invokes the same gate through
`snap run iptvnator --embedded-mpv-runtime-probe`. This packaging-only
application switch runs before BrowserWindow startup, emits one availability
JSON line, and returns zero only for a usable runtime; it never directly loads
libmpv in Electron. The installed-Snap smoke adds `EGL_LOG_LEVEL=debug` and
`LIBGL_DEBUG=verbose` under that bounded trace channel to expose GLVND/Mesa
loader failures without weakening the hostile-environment gate.

Electron Builder excludes `electron-backend/native{,/**/*}` from `app.asar`.
Only `afterPack` writes the profile-normalized
`app.asar.unpacked/electron-backend/native` tree. Layout and final-artifact
verification enumerate `app.asar` and reject any stale native entry, preventing
hidden x64 helpers, bundled libraries, or notices in system and marker-only
packages.

## CI And Source Distribution

Linux CI builds or restores the pinned source runtime once, then packages and
verifies `system`, `portable`, and `flatpak` independently. Every artifact is
extracted for manifest, mode, package-metadata, ELF-isolation, and helper-probe
checks. System formats are probed after their declared dependency is installed;
Snap and Flatpak also require a sandboxed probe where the runner supports it.
For a locally installed `--dangerous` Snap, CI explicitly installs and
connects `mesa-core22` and `gnome-3-28-1804`, verifies both connections, and
then runs the application-level diagnostic under Xvfb.
The Linux packaging matrix alone depends on the runtime-builder job. macOS and
Windows use an independent matrix, while both matrices share the same anchored
step list; draft release assembly remains atomic and requires both matrices.

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
configuration; the public fallback is for non-tag artifacts only. The upstream
keeps only its latest 30 daily builds, so the fallback URL and checksum plus any
matching repository variables must be refreshed as one pair before they age
out. A permanent mirror must publish the corresponding source/build records and
license notices with the binary.

## Local Development

Linux can use distribution development packages for an unshipped local build
(`libmpv-dev`, EGL/GL/GBM development files, and X11 headers). Overrides:
`LIBMPV_INCLUDE_DIR` selects the header root. `LINUX_NATIVE_LIBRARY_DIR`
selects a link-time library directory that must already be visible to the
system dynamic loader; it is not inherited as a helper `LD_LIBRARY_PATH`.
Required/release package builds must use the pinned staged runtime and manifest.

On macOS:

```bash
pnpm run serve:backend:embedded-mpv
```

This explicitly permits Homebrew for the local native build and enables the
experiment. It is not a release path.

See `docs/architecture/embedded-mpv-native.md` for the runtime capability,
fallback, controls, and packaged-release contracts.
