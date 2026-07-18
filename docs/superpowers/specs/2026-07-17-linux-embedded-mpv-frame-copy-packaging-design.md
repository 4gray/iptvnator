# Linux Embedded MPV Frame-Copy Packaging Design

**Date:** 2026-07-17

**Status:** Approved

## Goal

Ship a genuinely usable Embedded MPV frame-copy runtime in every official
Linux x64 package format produced by IPTVnator: AppImage, DEB, RPM, Pacman,
Snap, and Flatpak. Keep libmpv outside the Electron process, retain the
existing native-view engine as a safe fallback, and never advertise
frame-copy from artifact presence alone.

Linux arm64 and armv7l remain out of scope for native Embedded MPV artifacts.
The current CI cross-packages those architectures from an x64 host and cannot
produce or exercise matching native addons. Those packages must continue to
carry an explicit unavailable marker and must not contain x64 native binaries.

## Evidence From The Existing Implementation

- `apps/electron-backend/native/binding.gyp` builds three distinct artifacts:
  the native-view addon, the N-API shared-memory frame reader, and the
  `iptvnator_mpv_helper` process. On Linux only the helper links `-lmpv`; the
  addon uses X11/Xext/dlopen and must remain free of libmpv linkage.
- `tools/packaging/embedded-mpv-frame-copy-files.cjs` deliberately deletes the
  helper from every Linux package.
- `tools/packaging/embedded-mpv-packaging.cjs` rejects Linux packages that
  contain either the helper or libmpv, and accepts only the
  `external-mpv-process` manifest origin.
- `resolveFrameCopyHelperPath()` currently treats an executable helper plus a
  readable reader addon as a usable runtime. It does not prove that the ELF
  loader can resolve libmpv or that libmpv/EGL initialization works.
- `.github/workflows/build-and-make.yaml` builds and verifies the Linux helper
  against Ubuntu's system libmpv, then relies on the after-pack hook to remove
  it. The same x64 build output is used for foreign-architecture Linux
  packages, which receive the unavailable marker.
- Electron Builder creates one unpacked application layout before producing
  multiple distributable targets. A system-runtime layout and a bundled
  portable-runtime layout therefore cannot safely share one packaging pass.

## Selected Distribution Strategy

Linux packaging is split into explicit profiles:

| Profile    | Formats          | libmpv strategy                                                            |
| ---------- | ---------------- | -------------------------------------------------------------------------- |
| `system`   | DEB, RPM, Pacman | Depend on the distribution package and resolve `libmpv.so.2` from the host |
| `portable` | AppImage, Snap   | Bundle the pinned LGPL-compatible runtime closure under `native/lib`       |
| `flatpak`  | Flatpak          | Bundle the same pinned LGPL-compatible runtime closure under `native/lib`  |

The official CI matrix must run these profiles independently. The packaging
hook receives the profile through a required environment value and validates
that the selected target set matches the runtime mode. It must fail closed if
an official x64 package is requested with an absent, incomplete, or ambiguous
profile.

System package dependencies are:

- DEB: `libmpv2`, `libegl1`, `libgl1`, `libgbm1`
- RPM: `mpv-libs`, `libglvnd-egl`, `libglvnd-glx`, `mesa-libgbm`
- Pacman: `mpv`, `libglvnd`, `mesa`

These names match the current Debian, Fedora, and Arch package databases and
cover every direct helper interface: libmpv, EGL, GL, and GBM. The helper
links `libGL.so.1` rather than `libOpenGL.so.0`, matching both the distro
contracts and Snap's graphics provider. System
packages do not copy libmpv into IPTVnator. The helper keeps an `$ORIGIN/lib`
RUNPATH first for a consistent binary, but naturally resolves the system SONAME
when the private directory is absent.

Portable and sandboxed packages use a source-built runtime rather than copying
the Ubuntu runner's mpv package. The runtime build is checksum/version pinned,
uses FFmpeg without GPL/nonfree switches and mpv with `-Dgpl=false`, records
sources and exact flags in the manifest, and keeps shared libraries replaceable
under the LGPL. The minimal codec baseline is FFmpeg's built-in LGPL decoders,
demuxers, protocols, and software scaling/resampling plus libass text
subtitles. Hardware decoding remains opportunistic through host Mesa/driver
interfaces and must fall back to software decoding.

The source build also pins the `hwdata` v0.409 archive and its SHA-256 because
libdisplay-info 0.1.1 compiles `pnp.ids` into its generated vendor lookup
table. The builder stages that file with private `hwdata.pc` metadata and
restricts libdisplay-info's native pkg-config search to the staged prefix, so
Meson's `/usr/share/hwdata/pnp.ids` fallback cannot make the runtime depend on
unrecorded host data. The runtime manifest records this build-input
relationship. Release source bundles must include the exact hwdata archive and
its dual-license notice (`GPL-2.0-or-later OR XFree86-1.0`) alongside the
MIT-licensed libdisplay-info source.

The strict Snap uses `base: core22`, a private `shared-memory` plug, and an
exact `graphics-core22` content plug targeting a real empty mode-0755
`$SNAP/graphics` with external `mesa-core22` as default provider. The graphics provider supplies
EGL/GL/GLX/GBM/DRM/VA; Electron Builder's GNOME content runtime supplies
ALSA/PulseAudio. Those shared providers are not copied into IPTVnator's Snap or
source/notices archive. Because core22 does not synthesize `$SNAP` content
targets, the package hook creates the empty directory and extracted-artifact
validation checks its type and emptiness. The metadata also declares exactly
the canonical graphics layouts: `/usr/share/libdrm` binds from
`$SNAP/graphics/libdrm`, and `/usr/share/drirc.d` symlinks to
`$SNAP/graphics/drirc.d`. Locally installed `--dangerous` artifacts explicitly
install and connect both providers in CI, disconnect `graphics-core22` to
require an unavailable application diagnostic with exit code `1`, then
reconnect it and require success.

## Runtime Layout And Linkage

The x64 packaged native directory is:

```text
resources/app.asar.unpacked/electron-backend/native/
  embedded_mpv.node
  embedded_mpv_frame_reader.node
  iptvnator_mpv_helper
  embedded-mpv-runtime.json
  lib/
    libmpv.so.2
    libavcodec.so.*
    libavformat.so.*
    libavutil.so.*
    libavfilter.so.*
    libswresample.so.*
    libswscale.so.*
    libass.so.*
    ...other non-system runtime dependencies
```

For `system`, `lib/` is absent and the manifest declares the required SONAME
and package-family dependency. For `portable` and `flatpak`, `lib/` contains
the complete non-system dependency closure. ELF dependencies inside that
closure and the helper use only SONAMEs plus `$ORIGIN`-relative RPATH/RUNPATH;
they may not retain build-prefix paths.

`embedded_mpv.node`, the Electron executable (`iptvnator.bin`), and Electron's
shipped libraries must not have a direct `DT_NEEDED` entry for libmpv.
`iptvnator_mpv_helper` must have one. Process isolation is an invariant, not a
profile-specific choice. The source `electron-backend/native{,/**/*}` tree is
excluded from `app.asar`; `afterPack` is the sole owner of the normalized
unpacked native directory, and package checks reject every archived native
entry. The pristine Electron tree is scanned recursively
before target packaging. Because Snap later overlays package-manager
`lib/**`/`usr/lib/**` trees into the payload root, its extracted-target scan
excludes exactly those two target-provided trees while remaining recursive
everywhere else. Electron-library symlinks outside those roots fail closed.

The manifest records:

- schema version, platform, architecture, profile, and runtime origin;
- required helper/reader names and executable/readable expectations;
- libmpv SONAME and either system package requirements or bundled files;
- source package versions, URLs/checksums, license identifiers, and exact
  FFmpeg/mpv build flags for bundled profiles;
- the pinned hwdata `pnp.ids` build input consumed by libdisplay-info;
- runtime closure and total byte size;
- the native-view backend contract and the fact that only the helper links
  libmpv.

## Honest Capability Detection

The helper gains a side-effect-free `--runtime-probe` mode. It must:

1. load through the normal ELF loader and therefore prove that all `DT_NEEDED`
   dependencies resolve;
2. create and initialize an idle libmpv handle with `vo=libmpv`;
3. create the platform render pipeline far enough to prove EGL/OpenGL/GBM
   availability without opening media;
4. create, map, validate, and destroy the minimal shared-memory ring required
   by playback;
5. emit one versioned JSON result and exit promptly with status zero only on
   success.

The main process invokes this probe synchronously with a bounded timeout before
BrowserWindow creation. Probe success is cached for the process lifetime.
The probe environment prepends the packaged `native/lib` directory only when
the manifest declares a bundled runtime. The system profile does not inject a
private loader path. Snap additionally rebuilds its loader and graphics-driver
variables from validated host GL, `$SNAP/graphics`, exact GNOME-platform, and
generic core22 roots; ambient preload/audit/library/driver overrides and
caller-provided architecture triplets are not inherited. The direct provider
wrapper launch also removes shell startup/options, tracing hooks, and exported
functions and fixes `PATH` to immutable core22 system directories.

Packaging CI invokes the full main-process gate with the exact
`--embedded-mpv-runtime-probe` application switch. It executes before
BrowserWindow startup, writes one availability JSON line, and exits zero only
for a usable runtime. CI does not treat a direct helper invocation or an
environment opt-in as proof of packaged capability.

Frame-copy is usable only when all of the following are true:

- platform and architecture are supported;
- helper and reader are regular files with correct access modes;
- the runtime manifest is present, parses, matches Linux/x64, names the actual
  artifacts, and uses an allowed profile/origin;
- every manifest-declared bundled file exists as a readable regular file;
- `--runtime-probe` succeeds and returns the expected protocol version.

Any failure returns `false`, keeps the renderer sandbox enabled, and makes the
native service choose native-view. The capability result includes a stable
reason code for tracing and diagnostics but does not crash startup.

If dependencies disappear after startup, helper spawn/early-exit remains a
session error and follows the existing renderer fallback path. The helper is
never loaded into Electron as a library.

## Packaging And CI Validation

Unit and packaging tests cover:

- profile-to-target mapping and rejection of mixed system/bundled passes;
- Linux runtime staging, manifest normalization, closure collection, RPATH,
  file modes, and stale-artifact cleanup;
- package validation for system, portable, Flatpak, foreign architecture, and
  malformed/incomplete manifests;
- capability probe timeout, nonzero exit, invalid JSON, manifest mismatch,
  missing dependency, and successful result caching;
- exclusion of all native payloads from `app.asar`, including marker-only ARM
  and system-package stale x64 artifacts;
- helper probe protocol and failure behavior;
- package metadata dependencies for DEB/RPM/Pacman.

Linux CI must:

1. build or restore the pinned x64 LGPL runtime;
2. build the addon, reader, and helper once against that staged runtime;
3. prove with `readelf`/`ldd` that Electron and `embedded_mpv.node` do not link
   libmpv and the helper does;
4. package the three profiles independently;
5. unpack or mount each produced format and validate its real payload, modes,
   manifest, RPATH, dependency closure, and profile;
6. install/run the application-level packaged gate inside the actual Snap and
   Flatpak (with the exact Freedesktop 24.08 EGL external-platform path
   reconstructed inside `/app`), and probe the AppImage payload;
7. install system packages in matching disposable distro containers and run
   the helper probe after the declared libmpv dependency is installed;
8. run a packaged Electron smoke test that confirms frame-copy capability,
   creates a helper session against a deterministic local media fixture, sees
   at least one frame/snapshot, and then repeats with libmpv hidden or removed
   to prove non-crashing native-view fallback.

Checks that require Linux kernel/package tooling or GPU/EGL are CI-only.
macOS development can run all pure Node/Jest tests and static source checks,
but cannot establish Linux ELF, package-manager, sandbox, or rendering
behavior.

## Documentation And Release Compliance

Update `docs/architecture/embedded-mpv-native.md`,
`tools/embedded-mpv/README.md`, `vendor/embedded-mpv/README.md`,
`AGENTS.md`, and `CLAUDE.md`. The docs must describe the x64 format matrix,
profile selection, manifest/probe contract, process-isolation invariant,
fallback behavior, source-distribution obligations, codec baseline, and ARM
status.

Release artifacts must publish the generated runtime manifest and exact source
archives/metadata required by the recorded LGPL source-distribution statement.
The libplacebo payload is a VCS-metadata-free working-tree snapshot with exact
commit/submodule records, so clone-local `.git` state cannot perturb the
compliance tar. Automated Snap publication must wait for a public `v*` release
that already contains both the Snap assets and the exact source archive. Snap
Store publication remains outside this implementation and requires its
separate release workflow; repository integration follows explicit maintainer
authorization.
