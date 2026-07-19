# Linux Embedded MPV Frame-Copy Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a verified Linux x64 frame-copy runtime in AppImage, DEB, RPM, Pacman, Snap, and Flatpak while preserving out-of-process libmpv isolation and honest native-view fallback.

**Architecture:** Split official Linux packaging into system-runtime and bundled-runtime passes because Electron Builder reuses one unpacked layout per pass. A versioned manifest plus a real helper `--runtime-probe` gates frame-copy before BrowserWindow creation; only the helper may link libmpv, and foreign-architecture packages retain the unavailable marker.

**Tech Stack:** Electron 41, Node/TypeScript, C++17/N-API, libmpv render API, EGL/OpenGL/GBM, ELF/RPATH tooling, electron-builder 26, Nx/Jest/node:test, Playwright, GitHub Actions, AppImage/DEB/RPM/Pacman/Snap/Flatpak.

---

## File Map

### Runtime contracts and staging

- Create `tools/embedded-mpv/linux-runtime-manifest.cjs`
    - Parse, normalize, and validate Linux frame-copy runtime manifests.
- Create `tools/embedded-mpv/build-linux-runtime.mjs`
    - Build the pinned LGPL-compatible FFmpeg/libass/libplacebo/libmpv prefix.
- Modify `tools/embedded-mpv/stage-runtime.mjs`
    - Stage Linux shared libraries and reject incomplete release manifests.
- Modify `apps/electron-backend/build-embedded-mpv.js`
    - Build against staged Linux libmpv, copy the bundled closure, and emit the
      profile-neutral build manifest.
- Modify `apps/electron-backend/native/binding.gyp`
    - Keep helper RPATH relative and remove build-host RPATH.
- Modify `package.json`
    - Expose the Linux runtime build command.

### Packaging profiles and validation

- Create `tools/packaging/linux-frame-copy-profile.cjs`
    - Own profile names, target sets, manifest origins, and package dependencies.
- Create `tools/packaging/linux-frame-copy-profile.test.mjs`
    - Verify profile/target/dependency mapping and invalid combinations.
- Modify `electron-builder.json`
    - Declare DEB/RPM/Pacman libmpv dependencies.
- Modify `tools/packaging/embedded-mpv-frame-copy-files.cjs`
    - Package Linux helper/reader and select/remove private runtime by profile.
- Modify `tools/packaging/embedded-mpv-packaging.cjs`
    - Validate Linux ELF linkage, manifest, files, modes, RPATH, and isolation.
- Modify `tools/packaging/embedded-mpv-arch.test.mjs`
    - Cover system, bundled, malformed, and foreign-architecture layouts.
- Modify `tools/packaging/electron-after-pack.cjs`
    - Pass the required Linux profile into preparation and validation.
- Modify `tools/packaging/verify-electron-package-layout.mjs`
    - Verify the expected profile for every unpacked layout.
- Modify `tools/packaging/project.json`
    - Add new tests and source inputs.

### Runtime capability probe

- Modify `apps/electron-backend/native/helper/frame_helper_gl.h`
    - Provide a context-only probe that does not create a playback session.
- Modify `apps/electron-backend/native/helper/mpv_frame_helper.cpp`
    - Implement the versioned `--runtime-probe` JSON protocol.
- Create `apps/electron-backend/src/app/services/embedded-mpv-frame-copy-runtime.ts`
    - Validate manifest/files and run/cache the bounded helper probe.
- Create `apps/electron-backend/src/app/services/embedded-mpv-frame-copy-runtime.spec.ts`
    - Cover all fail-closed paths and success caching.
- Modify `apps/electron-backend/src/app/services/embedded-mpv-frame-copy-platform.util.ts`
    - Resolve an artifact set and delegate usability to the runtime probe.
- Modify `apps/electron-backend/src/app/services/embedded-mpv-frame-copy-platform.util.spec.ts`
    - Keep path/security coverage and add manifest/probe integration cases.
- Modify `apps/electron-backend/src/app/services/embedded-mpv-native.service.ts`
    - Surface stable fallback diagnostics without changing native-view safety.

### Linux CI, package smoke, and documentation

- Create `tools/packaging/verify-linux-frame-copy-runtime.mjs`
    - Inspect real package payload ELF/modes/manifest and invoke the helper probe.
- Create `tools/packaging/verify-linux-frame-copy-runtime.test.mjs`
    - Unit-test verifier parsing and failure reporting with fixtures.
- Create `apps/electron-backend-e2e/src/embedded-mpv-frame-copy-packaged.e2e.ts`
    - Exercise packaged capability, a deterministic media frame, and fallback.
- Modify `.github/workflows/build-and-make.yaml`
    - Build/cache runtime, split profiles, inspect every format, and run sandbox
      and container smoke coverage.
- Modify `docs/architecture/embedded-mpv-native.md`
- Modify `tools/embedded-mpv/README.md`
- Modify `vendor/embedded-mpv/README.md`
- Modify `AGENTS.md`
- Modify `CLAUDE.md`
    - Document the final contract and verification matrix.

## Task 1: Define Linux Packaging Profiles

**Files:**

- Create: `tools/packaging/linux-frame-copy-profile.cjs`
- Create: `tools/packaging/linux-frame-copy-profile.test.mjs`
- Modify: `electron-builder.json`
- Modify: `tools/packaging/project.json`

- [ ] **Step 1: Write failing profile tests**

Cover the exact public API:

```js
assert.deepEqual(resolveLinuxFrameCopyProfile('system'), {
    name: 'system',
    runtimeMode: 'system',
    targets: ['deb', 'rpm', 'pacman'],
    manifestOrigin: 'system-libmpv-frame-copy',
});
assert.deepEqual(resolveLinuxFrameCopyProfile('portable').targets, [
    'appimage',
    'snap',
]);
assert.deepEqual(resolveLinuxFrameCopyProfile('flatpak').targets, ['flatpak']);
assert.throws(() => resolveLinuxFrameCopyProfile('standard'), /Unsupported/);
assert.deepEqual(LINUX_SYSTEM_PACKAGE_DEPENDENCIES, {
    deb: 'libmpv2',
    rpm: 'mpv-libs',
    pacman: 'mpv',
});
assert.deepEqual(validateLinuxProfileTargets('system', ['deb', 'AppImage']), [
    'Linux frame-copy profile "system" cannot build target "appimage".',
]);
```

- [ ] **Step 2: Run RED**

```bash
node --test tools/packaging/linux-frame-copy-profile.test.mjs
```

Expected: FAIL because the profile module does not exist.

- [ ] **Step 3: Implement the profile module and package dependencies**

Export immutable `LINUX_FRAME_COPY_PROFILES`,
`LINUX_SYSTEM_PACKAGE_DEPENDENCIES`, `resolveLinuxFrameCopyProfile()`, and
`validateLinuxProfileTargets()`. Add `deb.depends += libmpv2`,
`rpm.depends += mpv-libs`, and `pacman.depends += mpv` without replacing
Electron Builder's existing defaults.

- [ ] **Step 4: Register and run GREEN**

Add the new test to `packaging:test`, then run:

```bash
pnpm nx test packaging --skip-nx-cache
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron-builder.json tools/packaging
git commit -m "feat(packaging): define Linux frame-copy profiles"
```

## Task 2: Stage A Pinned LGPL Linux Runtime

**Files:**

- Create: `tools/embedded-mpv/linux-runtime-manifest.cjs`
- Create: `tools/embedded-mpv/linux-runtime-manifest.test.mjs`
- Create: `tools/embedded-mpv/build-linux-runtime.mjs`
- Modify: `tools/embedded-mpv/stage-runtime.mjs`
- Modify: `package.json`
- Modify: `tools/packaging/project.json`

- [ ] **Step 1: Write failing manifest/staging tests**

Use temporary prefixes to prove:

```js
assert.equal(validateLinuxRuntimeManifest(validManifest).length, 0);
assert.match(
    validateLinuxRuntimeManifest({
        ...validManifest,
        ffmpeg: { configureFlags: ['--enable-gpl'] },
    })[0],
    /--enable-gpl/
);
assert.match(
    validateLinuxRuntimeManifest({
        ...validManifest,
        mpv: { mesonFlags: ['-Dgpl=true'] },
    })[0],
    /-Dgpl=false/
);
```

Exercise `stage-runtime.mjs linux x64 <prefix>` and assert it copies
`libmpv.so.2` plus all manifest-declared `.so` files and records byte sizes.

- [ ] **Step 2: Run RED**

```bash
node --test tools/embedded-mpv/linux-runtime-manifest.test.mjs
```

Expected: FAIL because the validator/build/staging contract is absent.

- [ ] **Step 3: Implement the source builder**

Reuse the pinned package versions already used by the macOS builder. Linux
FFmpeg flags must include:

```text
--enable-shared --disable-static --disable-programs --disable-doc
--disable-debug --disable-autodetect --disable-gpl --disable-nonfree
--enable-pic --enable-pthreads
```

Linux mpv flags must include:

```text
-Dgpl=false -Dlibmpv=true -Dcplayer=false -Dtests=false
-Dlua=disabled -Djavascript=disabled -Dcplugins=disabled
-Dlibarchive=disabled -Dlibbluray=disabled -Ddvdnav=disabled
-Dcdda=disabled -Ddvbin=disabled -Dvulkan=disabled
-Dplain-gl=enabled -Degl=enabled -Dgbm=enabled
```

Record downloaded SHA-256 values, git commits/submodules, exact flags, runtime
file names/sizes, and source-distribution obligations. Pin the hwdata v0.409
archive and record its `pnp.ids` as a build input to libdisplay-info 0.1.1.
Stage private `hwdata.pc` metadata and run libdisplay-info's Meson setup with a
prefix-only pkg-config environment so the upstream
`/usr/share/hwdata/pnp.ids` fallback is unreachable. Include the exact hwdata
archive and its `GPL-2.0-or-later OR XFree86-1.0` notice in the release source
bundle.

- [ ] **Step 4: Implement Linux staging**

Require `include/mpv/client.h`, a versioned `libmpv.so.*`, and a valid manifest.
Copy only manifest-declared shared libraries and preserve SONAME symlinks as
materialized regular files so Electron Builder cannot lose them.

- [ ] **Step 5: Run GREEN and static policy checks**

```bash
pnpm nx test packaging --skip-nx-cache
node --check tools/embedded-mpv/build-linux-runtime.mjs
node --check tools/embedded-mpv/stage-runtime.mjs
```

Expected: PASS and no GPL/nonfree-enabling flag in generated policy fixtures.

- [ ] **Step 6: Commit**

```bash
git add package.json tools/embedded-mpv tools/packaging/project.json
git commit -m "feat(embedded-mpv): stage LGPL Linux runtime"
```

## Task 3: Build A Relocatable Isolated Helper

**Files:**

- Modify: `apps/electron-backend/native/binding.gyp`
- Modify: `apps/electron-backend/build-embedded-mpv.js`
- Test: `apps/electron-backend/src/app/services/embedded-mpv-native-source.spec.ts`

- [ ] **Step 1: Extend source-policy tests**

Assert the Linux helper has `$ORIGIN/lib` and no absolute build-host RPATH,
the addon does not use `-lmpv`, the staged closure is copied, and the build
manifest identifies both allowed package modes.

- [ ] **Step 2: Run RED**

```bash
pnpm nx test electron-backend --skip-nx-cache --runInBand \
  --testPathPatterns=embedded-mpv-native-source.spec
```

Expected: FAIL on the current absolute `LINUX_NATIVE_LIBRARY_DIR` RPATH and
`external-mpv-process`-only manifest.

- [ ] **Step 3: Update native build integration**

Link the helper against staged `libmpv.so`, retain only:

```text
-Wl,--enable-new-dtags
-Wl,-rpath,$ORIGIN/lib
```

Copy the staged shared-library closure to build output for downstream bundled
profiles, but keep `embedded_mpv.node` dynamically independent of libmpv.
Write a build manifest that carries the runtime metadata without prematurely
choosing `system` versus `portable`.

- [ ] **Step 4: Run GREEN**

```bash
pnpm nx test electron-backend --skip-nx-cache --runInBand \
  --testPathPatterns=embedded-mpv-native-source.spec
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/electron-backend/native/binding.gyp \
  apps/electron-backend/build-embedded-mpv.js \
  apps/electron-backend/src/app/services/embedded-mpv-native-source.spec.ts
git commit -m "feat(embedded-mpv): build relocatable Linux helper"
```

## Task 4: Package And Validate Each Runtime Mode

**Files:**

- Modify: `tools/packaging/embedded-mpv-frame-copy-files.cjs`
- Modify: `tools/packaging/embedded-mpv-packaging.cjs`
- Modify: `tools/packaging/embedded-mpv-arch.test.mjs`
- Modify: `tools/packaging/electron-after-pack.cjs`
- Modify: `tools/packaging/verify-electron-package-layout.mjs`

- [ ] **Step 1: Write failing package-layout tests**

Create realistic temp layouts and prove:

- system mode requires executable helper, reader, system manifest, no
  `native/lib/libmpv*`;
- bundled mode requires all manifest files and rejects missing/runtime-prefix
  links;
- helper mode `0644` is rejected;
- reader symlinks/directories are rejected;
- Linux addon or Electron `DT_NEEDED libmpv` is rejected;
- helper without `DT_NEEDED libmpv.so.2` is rejected;
- foreign-arch layout contains only the unavailable marker.

- [ ] **Step 2: Run RED**

```bash
pnpm nx test packaging --skip-nx-cache
```

Expected: FAIL because Linux helpers are deleted and validation forbids them.

- [ ] **Step 3: Implement profile-aware preparation**

For x64:

- restore helper mode `0755`;
- always retain the frame reader;
- `system`: remove private runtime and write normalized system manifest;
- `portable`/`flatpak`: retain only manifest-declared closure and write bundled
  manifest;
- reject missing `IPTVNATOR_LINUX_FRAME_COPY_PROFILE` when Embedded MPV is
  required.

For foreign architectures, keep the current unavailable marker behavior and
remove every native artifact.

- [ ] **Step 4: Implement ELF/package validation**

Use `readelf -d` for `NEEDED` and RPATH/RUNPATH inspection. Resolve bundled
closure recursively from the private directory and permit only a documented
glibc/driver/system allowlist outside it. Keep validation host-aware: pure
manifest/mode checks run everywhere; ELF inspection is required on Linux CI.

- [ ] **Step 5: Run GREEN**

```bash
pnpm nx test packaging --skip-nx-cache
pnpm nx test electron-backend --skip-nx-cache --runInBand \
  --testPathPatterns=embedded-mpv-native-source.spec
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/packaging
git commit -m "feat(packaging): ship Linux frame-copy artifacts"
```

## Task 5: Add The Real Runtime Capability Probe

**Files:**

- Modify: `apps/electron-backend/native/helper/frame_helper_gl.h`
- Modify: `apps/electron-backend/native/helper/mpv_frame_helper.cpp`
- Create: `apps/electron-backend/src/app/services/embedded-mpv-frame-copy-runtime.ts`
- Create: `apps/electron-backend/src/app/services/embedded-mpv-frame-copy-runtime.spec.ts`
- Modify: `apps/electron-backend/src/app/services/embedded-mpv-frame-copy-platform.util.ts`
- Modify: `apps/electron-backend/src/app/services/embedded-mpv-frame-copy-platform.util.spec.ts`
- Modify: `apps/electron-backend/src/app/services/embedded-mpv-native.service.ts`

- [ ] **Step 1: Write failing TypeScript probe tests**

Inject filesystem and `spawnSync` collaborators. Cover:

```ts
expect(probeRuntime(validArtifacts, successSpawn).usable).toBe(true);
expect(probeRuntime(validArtifacts, timeoutSpawn).reason).toBe(
    'helper-probe-timeout'
);
expect(probeRuntime(validArtifacts, nonzeroSpawn).reason).toBe(
    'helper-probe-failed'
);
expect(probeRuntime(validArtifacts, invalidJsonSpawn).reason).toBe(
    'helper-probe-invalid-output'
);
expect(probeRuntime(missingManifest, successSpawn).reason).toBe(
    'runtime-manifest-missing'
);
expect(successSpawn).toHaveBeenCalledTimes(1);
```

The last assertion calls the public probe twice and proves process-lifetime
caching.

- [ ] **Step 2: Run RED**

```bash
pnpm nx test electron-backend --skip-nx-cache --runInBand \
  --testPathPatterns=embedded-mpv-frame-copy-runtime.spec
```

Expected: FAIL because the runtime probe module does not exist.

- [ ] **Step 3: Implement helper `--runtime-probe`**

Emit exactly one line:

```json
{ "protocol": 1, "usable": true, "libmpv": "2.x", "renderApi": "egl" }
```

Exit nonzero with a JSON `reason` when `mpv_create`, `mpv_initialize`, or the
EGL/OpenGL context probe fails. Do not create shared memory, open a URL, or
enter the normal command loop.

- [ ] **Step 4: Implement fail-closed main-process probing**

Validate manifest/artifacts first, then run:

```ts
spawnSync(helperPath, ['--runtime-probe'], {
    encoding: 'utf8',
    timeout: 3000,
    windowsHide: true,
    env: probeEnvironment,
});
```

Cache by helper/manifest identity. Never throw across startup; return a stable
reason and make `isFrameCopyRuntimeUsable()` depend on `.usable`.

- [ ] **Step 5: Run GREEN and related regression tests**

```bash
pnpm nx test electron-backend --skip-nx-cache --runInBand \
  --testPathPatterns='embedded-mpv-frame-copy-(runtime|platform).util.spec|app.spec|embedded-mpv-native.service.spec'
```

Expected: PASS; unavailable runtime keeps sandbox enabled and selects native.

- [ ] **Step 6: Commit**

```bash
git add apps/electron-backend/native/helper \
  apps/electron-backend/src/app/services
git commit -m "feat(embedded-mpv): probe Linux frame-copy runtime"
```

## Task 6: Split Linux CI And Inspect Every Artifact

**Files:**

- Create: `tools/packaging/verify-linux-frame-copy-runtime.mjs`
- Create: `tools/packaging/verify-linux-frame-copy-runtime.test.mjs`
- Modify: `.github/workflows/build-and-make.yaml`
- Modify: `tools/packaging/project.json`

- [ ] **Step 1: Write failing verifier tests**

Test payload discovery for `.AppImage`, `.deb`, `.rpm`, Pacman archive,
`.snap`, and `.flatpak`, plus clear errors for a missing helper, wrong mode,
wrong profile, direct addon libmpv linkage, and unresolved helper dependency.

- [ ] **Step 2: Run RED**

```bash
node --test tools/packaging/verify-linux-frame-copy-runtime.test.mjs
```

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement artifact verification**

Provide `--artifact <path> --profile <name>`. Extract/mount into a temp
directory, find the native layout, run manifest/mode/ELF checks, and execute
`iptvnator_mpv_helper --runtime-probe` in the package's intended environment.
Always clean temporary mounts/directories.

- [ ] **Step 4: Split and harden CI**

Change Linux matrix entries to:

```yaml
- os: linux
  linux_profile: system
- os: linux
  linux_profile: portable
- os: linux
  linux_profile: flatpak
```

Filter targets exactly per profile and set
`IPTVNATOR_LINUX_FRAME_COPY_PROFILE`. Build/cache the pinned runtime once per
source/tool hash. Add format-specific extraction/installation tools and invoke
the verifier for every produced artifact.

Run system formats in matching containers with `libmpv2`, `mpv-libs`, or
`mpv`; run AppImage directly with extraction fallback; install and probe Snap
and Flatpak inside their sandboxes.

- [ ] **Step 5: Run GREEN and workflow source regressions**

```bash
pnpm nx test packaging --skip-nx-cache
pnpm nx test electron-backend --skip-nx-cache --runInBand \
  --testPathPatterns=embedded-mpv-native-source.spec
```

Expected: PASS and source tests prove all three profiles and six formats.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/build-and-make.yaml tools/packaging
git commit -m "ci: verify Linux frame-copy packages"
```

## Task 7: Add Packaged Playback And Fallback Smoke Coverage

**Files:**

- Create: `apps/electron-backend-e2e/src/embedded-mpv-frame-copy-packaged.e2e.ts`
- Modify: `.github/workflows/build-and-make.yaml`

- [ ] **Step 1: Write the packaged E2E**

Use the existing Electron test fixtures and a generated two-second local media
fixture. Assert the support response reports `frameCopyAvailable: true`,
activate the engine, load the fixture, observe a nonzero frame generation and
playing/paused snapshot, then relaunch with the runtime hidden and assert
native engine selection without a main-process crash.

- [ ] **Step 2: Run the closest local parse/list check**

```bash
pnpm nx lint electron-backend-e2e
pnpm nx show project electron-backend-e2e
```

Expected: PASS on macOS; the actual test is Linux-packaged-only.

- [ ] **Step 3: Wire the Linux packaged smoke**

Run the spec against the unpacked x64 bundled layout under software EGL
(`LIBGL_ALWAYS_SOFTWARE=1`) and keep a hardware-enabled smoke as a separate
non-blocking diagnostic when the CI runner exposes DRI.

- [ ] **Step 4: Commit**

```bash
git add apps/electron-backend-e2e/src/embedded-mpv-frame-copy-packaged.e2e.ts \
  .github/workflows/build-and-make.yaml
git commit -m "test(embedded-mpv): smoke packaged Linux frame-copy"
```

## Task 8: Update Canonical Documentation

**Files:**

- Modify: `docs/architecture/embedded-mpv-native.md`
- Modify: `tools/embedded-mpv/README.md`
- Modify: `vendor/embedded-mpv/README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the dev-only Linux contract**

Document x64 support across all six formats, the three profiles, dependency
names, runtime manifest/probe, codec baseline, source obligations, fallback,
and ARM unavailable behavior. Keep `AGENTS.md` and `CLAUDE.md` synchronized.

- [ ] **Step 2: Verify documentation consistency**

```bash
rg -n "dev-build-only|stripped from packages|must not bundle libmpv" \
  AGENTS.md CLAUDE.md docs/architecture/embedded-mpv-native.md \
  tools/embedded-mpv/README.md vendor/embedded-mpv/README.md
git diff --check
```

Expected: no stale Linux frame-copy shipping claim; any remaining
“must not bundle” text applies specifically to Electron/addon or system
profiles.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md CLAUDE.md docs/architecture/embedded-mpv-native.md \
  tools/embedded-mpv/README.md vendor/embedded-mpv/README.md
git commit -m "docs: document Linux frame-copy packages"
```

## Task 9: Final Verification Matrix

**Files:** No production edits unless verification exposes a defect.

- [ ] **Step 1: Run local project discovery and affected checks**

```bash
pnpm nx show projects
pnpm nx test packaging --skip-nx-cache
pnpm nx test electron-backend --skip-nx-cache --runInBand
pnpm nx lint packaging --skip-nx-cache
pnpm nx lint electron-backend --skip-nx-cache
pnpm nx lint electron-backend-e2e --skip-nx-cache
pnpm nx build electron-backend --configuration=production --skip-nx-cache
```

Expected: PASS or an explicitly recorded platform-only native-build skip on
macOS without a vendored runtime.

- [ ] **Step 2: Verify isolation source and local artifacts**

```bash
rg -n -- '-lmpv|libmpv' apps/electron-backend/native/binding.gyp \
  tools/packaging apps/electron-backend/build-embedded-mpv.js
git diff --check origin/master...HEAD
git status --short
```

Expected: only the helper target links libmpv; no unstaged/unexplained files.

- [ ] **Step 3: Record the exact evidence matrix**

Report separately:

- verified locally on macOS: Node/Jest/lint/build/static/package-policy tests;
- structurally verified but not executable locally: Linux runtime builder and
  artifact extraction code;
- requires Linux CI: ELF resolution, actual six-format packages, package
  managers, Snap/Flatpak confinement, EGL/GBM, frame production, and fallback
  with libmpv removed.

- [ ] **Step 4: Stop before publication**

Do not push, open a PR, publish artifacts, or merge. Leave the fully checked
local branch ready for explicit user confirmation in a new task.
