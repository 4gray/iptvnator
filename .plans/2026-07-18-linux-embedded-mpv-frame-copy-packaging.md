# Linux Embedded MPV Frame-Copy Packaging Plan

## Audited baseline

- Linux frame-copy already has an isolated `iptvnator_mpv_helper`, a frame
  reader addon, shared controls, native-view fallback, and runtime capability
  probes.
- Existing packaged Linux builds intentionally remove the helper/runtime and
  retain only system `mpv --wid` native-view.
- Electron, Electron libraries, `embedded_mpv.node`, and
  `embedded_mpv_frame_reader.node` must never load or link libmpv. Only the
  helper may link it.
- Electron Builder produces AppImage, DEB, RPM, Pacman, Snap, and Flatpak
  Linux targets. The available reproducible native/runtime toolchain is x64.

## Decisions

1. Support official frame-copy artifacts on Linux x64 only. Keep every non-x64
   artifact marker-only and fail closed to native-view; never accept an
   architecture override that injects x64 native files.
2. Use three isolated packaging profiles:
   - `system`: DEB/RPM/Pacman use declared distribution libmpv/GL dependencies
     and contain no private `native/lib`.
   - `portable`: AppImage/Snap contain a pinned LGPL-compatible shared-library
     closure with `$ORIGIN`-relative helper loading.
   - `flatpak`: Flatpak contains the same pinned closure, validated in the
     exact `/app` runtime context.
3. Treat the package manifest as necessary but insufficient. Frame-copy is
   available only after exact manifest/schema/profile checks, executable-mode
   checks, artifact hashes, dependency-closure/process-isolation checks, and a
   bounded helper runtime probe. No environment flag bypasses this gate.
4. Publish exact source archives, recursive source identities, build flags,
   licenses, notices, patches/tooling, and pinned display data for bundled
   runtimes. Bind every bundled x64 package manifest to the final compliance
   archive bytes and released repository revision.
5. Keep Snap Store credentials isolated from release-tag code on a fresh
   runner. Store publication is edge-only; candidate/stable promotion remains
   manual after installed-package smoke.

## TDD implementation phases

1. Add failing tests for target/profile partitioning, x64 and marker-only
   layouts, exact dependency declarations, RPATH/SONAME rules, executable
   modes, and Electron/libmpv isolation.
2. Implement profile-aware build and packaging hooks that stage the helper,
   frame reader, runtime manifest, private closure where applicable, and legal
   payload without weakening native-view.
3. Add failing runtime-policy tests for missing/tampered files, wrong
   architecture/profile, malformed manifests, loader failures, hostile
   environments, probe timeout/output bounds, and stable fallback reasons.
4. Implement one sanitized helper environment shared by probe and playback,
   including Snap graphics-provider handling and Flatpak runtime paths.
5. Add failing compliance/release tests for exact recursive submodule records,
   VCS-free source inventory, archive member/type layout, source checksums,
   license/notices completeness, package-to-source byte binding, sealed asset
   receipts, and credential boundaries.
6. Implement deterministic source generation, package bindings, static Snap
   inspection, fresh-runner artifact transfer, and minimal direct Store
   upload.
7. Add packaged x64 smoke for actual frame-copy playback plus missing-runtime
   native-view fallback. Run fixture-contract tests before the smoke and allow
   CI llvmpipe through Chromium's GPU blocklist without bypassing the runtime
   gate.
8. Update canonical architecture/maintenance documentation and mirrored
   `AGENTS.md`/`CLAUDE.md` contracts.

## Acceptance and verification matrix

- Local/macOS:
  - Nx discovery
  - packaging and Electron backend unit/integration tests
  - packaged-smoke fixture tests
  - affected lint targets
  - production backend build
  - formatting, syntax, and `git diff --check`
- Linux x64 CI:
  - build the pinned runtime/helper/frame reader
  - verify helper links/resolves libmpv and Electron/addons do not
  - extract and statically validate all six package families
  - run system, portable, Snap-installed, and Flatpak application probes
  - run packaged frame-copy playback and missing-runtime native-view fallback
  - regenerate and bind the exact compliance source archive
- Non-x64 CI:
  - build selected ARM package targets independently
  - require marker-only layout and absence of every x64 native/runtime artifact
- Merge gate:
  - exact-head CI green
  - no unresolved review findings
  - fresh code review clean
  - no automatic Snap promotion beyond edge
