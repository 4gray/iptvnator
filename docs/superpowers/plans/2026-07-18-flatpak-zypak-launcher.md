# Flatpak Zypak Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Flatpak `iptvnator` entry as the real Electron ELF so
Electron Builder passes it directly to Zypak, while preserving the existing
Linux sandbox wrapper for every other package target.

**Architecture:** A small CommonJS launcher-layout contract resolves the
Electron binary name from normalized target names and rejects mixed Flatpak
passes. The afterPack hook, unpacked-layout validators, final-artifact
validator, and CI all consume the same target-dependent contract.

**Tech Stack:** Node.js CommonJS/ESM, `node:test`, Nx packaging targets,
Electron Builder 26, Flatpak/Zypak, GitHub Actions.

---

### Task 1: Add the shared launcher contract and fix afterPack

**Files:**

- Create: `tools/packaging/linux-launcher-layout.cjs`
- Create: `tools/packaging/linux-after-pack.test.mjs`
- Modify: `tools/packaging/linux-after-pack.cjs`
- Modify: `tools/packaging/electron-after-pack.cjs`
- Modify: `tools/packaging/project.json`

- [ ] **Step 1: Write the failing isolated-Flatpak hook test**

Create a temporary executable with ELF magic, call the real hook, and assert
that Flatpak retains the exact original file:

```js
test('preserves the Electron ELF for an isolated Flatpak target', async (t) => {
    const fixture = createLauncherFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

    await linuxAfterPack(createAfterPackParams(fixture.appOutDir, ['flatpak']));

    assert.deepEqual(
        fs.readFileSync(fixture.executablePath),
        fixture.executableBytes
    );
    assert.equal(fs.existsSync(`${fixture.executablePath}.bin`), false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tools/packaging/linux-after-pack.test.mjs
```

Expected: FAIL because the current hook replaces `iptvnator` with a Bash
script and creates `iptvnator.bin`.

- [ ] **Step 3: Add the pure launcher-layout resolver**

Implement a strict resolver with this public contract:

```js
function resolveLinuxLauncherLayout(targets, executableName = 'iptvnator') {
    if (!Array.isArray(targets) || targets.length === 0) {
        throw new Error(
            'Linux launcher layout requires at least one Electron Builder target.'
        );
    }

    const targetNames = targets.map((target) => {
        const value = typeof target === 'string' ? target : target?.name;
        const name = String(value ?? '')
            .trim()
            .toLowerCase();
        if (!name) {
            throw new Error(
                'Linux launcher targets must expose a non-empty name.'
            );
        }
        return name;
    });

    if (new Set(targetNames).size !== targetNames.length) {
        throw new Error('Linux launcher targets must be unique.');
    }

    const flatpak = targetNames.includes('flatpak');
    if (flatpak && targetNames.length !== 1) {
        throw new Error(
            'Flatpak must be packaged in an isolated Electron Builder pass so Zypak receives the Electron ELF directly.'
        );
    }

    return {
        targetNames,
        electronBinaryName: flatpak ? executableName : `${executableName}.bin`,
        wrapperRequired: !flatpak,
    };
}
```

Export `resolveLinuxLauncherLayout`.

- [ ] **Step 4: Make the Linux hook preserve isolated Flatpak**

Resolve the layout before any filesystem mutation. For Flatpak, log that the
ELF is preserved and return. For other targets, rename to the resolved
`electronBinaryName` and create the unchanged sandbox wrapper:

```js
async function afterPackHook(params, { targetNames = params.targets } = {}) {
    if (params.electronPlatformName !== 'linux') {
        return;
    }

    const layout = resolveLinuxLauncherLayout(
        targetNames,
        params.packager.executableName
    );
    if (!layout.wrapperRequired) {
        log('preserving Flatpak Electron ELF for direct Zypak launch');
        return;
    }

    const executable = path.join(
        params.appOutDir,
        params.packager.executableName
    );
    const electronBinary = path.join(
        params.appOutDir,
        layout.electronBinaryName
    );

    try {
        await fs.rename(executable, electronBinary);
        await fs.writeFile(
            executable,
            createLoaderScript({
                executableName: params.packager.executableName,
                productName: params.packager.appInfo.productName,
            })
        );
        await fs.chmod(executable, 0o755);
    } catch (error) {
        log(`failed to create launcher wrapper: ${error.message}`);
        throw new Error('Failed to create launcher wrapper');
    }

    log('Linux launcher sandbox fix applied');
}
```

Pass `linuxPackagingContext?.targetNames` from `electron-after-pack.cjs` so
the hook consumes the already validated afterPack target names:

```js
await linuxAfterPack(params, {
    targetNames: linuxPackagingContext?.targetNames,
});
```

- [ ] **Step 5: Add non-Flatpak and mixed-target regression cases**

Use the real hook to prove:

```js
test('keeps the sandbox wrapper for non-Flatpak targets', async (t) => {
    for (const targetName of ['appimage', 'deb', 'rpm', 'pacman', 'snap']) {
        const fixture = createLauncherFixture();
        t.after(() =>
            fs.rmSync(fixture.root, { recursive: true, force: true })
        );
        await linuxAfterPack(
            createAfterPackParams(fixture.appOutDir, [targetName])
        );
        assert.deepEqual(
            fs.readFileSync(`${fixture.executablePath}.bin`),
            fixture.executableBytes
        );
        assert.match(
            fs.readFileSync(fixture.executablePath, 'utf8'),
            /exec "\$SCRIPT_DIR\/iptvnator\.bin"/
        );
    }
});

test('rejects a mixed Flatpak pass before mutating the executable', async (t) => {
    const fixture = createLauncherFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    await assert.rejects(
        linuxAfterPack(
            createAfterPackParams(fixture.appOutDir, ['flatpak', 'appimage'])
        ),
        /Flatpak must be packaged in an isolated Electron Builder pass/
    );
    assert.deepEqual(
        fs.readFileSync(fixture.executablePath),
        fixture.executableBytes
    );
    assert.equal(fs.existsSync(`${fixture.executablePath}.bin`), false);
});
```

- [ ] **Step 6: Register and run the focused test**

Add `linux-after-pack.test.mjs` to the explicit `packaging:test` command and
inputs in `tools/packaging/project.json`.

Run:

```bash
node --test tools/packaging/linux-after-pack.test.mjs
```

Expected: all launcher tests PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add tools/packaging/linux-launcher-layout.cjs \
  tools/packaging/linux-after-pack.cjs \
  tools/packaging/linux-after-pack.test.mjs \
  tools/packaging/electron-after-pack.cjs \
  tools/packaging/project.json
git commit -m "fix(packaging): preserve Flatpak Electron ELF"
```

### Task 2: Make unpacked-layout validation target-aware

**Files:**

- Modify: `tools/packaging/embedded-mpv-packaging.cjs`
- Modify: `tools/packaging/embedded-mpv-arch.test.mjs`
- Modify: `tools/packaging/verify-electron-package-layout.mjs`
- Modify: `tools/packaging/electron-package-identity.test.mjs`

- [ ] **Step 1: Change the Flatpak fixture and verify RED**

In `prepares portable and Flatpak manifests with the exact bundled closure`,
rename only the Flatpak fixture's Electron binary:

```js
fs.renameSync(
    join(flatpak.appOutDir, 'iptvnator.bin'),
    join(flatpak.appOutDir, 'iptvnator')
);
```

Teach the test ELF inspector about both legitimate basenames:

```js
['iptvnator', { needed: ['libc.so.6'], rpath: [], runpath: [] }],
['iptvnator.bin', { needed: ['libc.so.6'], rpath: [], runpath: [] }],
```

Run:

```bash
node --test --test-name-pattern='prepares portable and Flatpak manifests' \
  tools/packaging/embedded-mpv-arch.test.mjs
```

Expected: FAIL with a missing `iptvnator.bin` validation error.

- [ ] **Step 2: Resolve the pristine Electron ELF through the shared contract**

Require `resolveLinuxLauncherLayout` in
`embedded-mpv-packaging.cjs`. In `inspectLinuxElfIsolation`, resolve from
`options.targetNames` and use its `electronBinaryName`:

```js
let launcherLayout;
try {
    launcherLayout = resolveLinuxLauncherLayout(
        options.targetNames,
        options.executableName ?? 'iptvnator'
    );
} catch (error) {
    errors.push(
        `Unable to resolve Linux launcher layout: ${
            error instanceof Error ? error.message : String(error)
        }`
    );
    return;
}

const inspectedPaths = {
    electron: path.join(
        path.dirname(resourceDir),
        launcherLayout.electronBinaryName
    ),
    addon: path.join(nativeDir, linuxFrameCopyArtifacts.addon.name),
    reader: path.join(nativeDir, linuxFrameCopyArtifacts.frameReader.name),
    helper: path.join(nativeDir, linuxFrameCopyArtifacts.helper.name),
};
for (const [index, libraryPath] of listElectronShippedLinuxLibraries(
    resourceDir,
    { artifactFormat: options.artifactFormat }
).entries()) {
    inspectedPaths[`electronLibrary:${index}`] = libraryPath;
}
```

Pass the normalized `targetNames` already calculated by
`validateLinuxPackagedEmbeddedMpv` into the inspection options.

- [ ] **Step 3: Make the general package-layout verifier profile-aware**

Require the same resolver in `verify-electron-package-layout.mjs`, change
`verifyLinuxLauncher` to accept `targetNames`, and call it with
`linuxTargetNames`.

For Flatpak:

```js
if (!layout.wrapperRequired) {
    if (fileExists(`${launcherPath}.bin`)) {
        errors.push(
            `Flatpak must not contain the Linux sandbox wrapper binary: ${launcherPath}.bin`
        );
    }
    if (!fileHasElfMagic(launcherPath)) {
        errors.push(
            `Flatpak launcher target must be an ELF executable: ${launcherPath}`
        );
    }
    return;
}

const launcherBinaryPath = path.join(appDir, layout.electronBinaryName);
if (!fileExists(launcherBinaryPath)) {
    errors.push(
        `Missing Linux launcher binary in ${appDir}: ${path.basename(launcherBinaryPath)}`
    );
    return;
}
if (!fileExists(launcherPath)) {
    errors.push(
        `Missing Linux launcher wrapper in ${appDir}: ${path.basename(launcherPath)}`
    );
    return;
}

const launcherScript = fs.readFileSync(launcherPath, 'utf8');
const requiredMarkers = [
    'SCRIPT_PATH="${BASH_SOURCE[0]}"',
    'readlink -f "$SCRIPT_PATH"',
    `exec "$SCRIPT_DIR/${linuxExecutableName}.bin"`,
];
const missingMarkers = requiredMarkers.filter(
    (marker) => !launcherScript.includes(marker)
);
if (missingMarkers.length > 0) {
    errors.push(
        [
            `Linux launcher wrapper is missing symlink-safe logic in ${launcherPath}.`,
            'Missing markers:',
            ...missingMarkers.map((marker) => `- ${marker}`),
        ].join('\n')
    );
}
```

Implement `fileHasElfMagic` with one four-byte `fs.readSync` call and always
close the descriptor:

```js
function fileHasElfMagic(filePath) {
    const descriptor = fs.openSync(filePath, 'r');
    try {
        const magic = Buffer.alloc(4);
        return (
            fs.readSync(descriptor, magic, 0, magic.length, 0) ===
                magic.length &&
            magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
        );
    } finally {
        fs.closeSync(descriptor);
    }
}
```

- [ ] **Step 4: Extend the package-identity source contract test**

Assert that the general verifier imports the shared resolver, calls
`verifyLinuxLauncher(resourceDir, linuxTargetNames, errors)`, checks ELF magic,
and does not unconditionally set `launcherBinaryPath` before resolving target
layout.

- [ ] **Step 5: Run targeted validation**

```bash
node --test --test-name-pattern='prepares portable and Flatpak manifests' \
  tools/packaging/embedded-mpv-arch.test.mjs
node --test --test-name-pattern='package layout verifier uses' \
  tools/packaging/electron-package-identity.test.mjs
```

Expected: both commands PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add tools/packaging/embedded-mpv-packaging.cjs \
  tools/packaging/embedded-mpv-arch.test.mjs \
  tools/packaging/verify-electron-package-layout.mjs \
  tools/packaging/electron-package-identity.test.mjs
git commit -m "fix(packaging): validate Flatpak launcher ELF"
```

### Task 3: Update final-artifact verification, CI, and documentation

**Files:**

- Modify: `tools/packaging/verify-linux-frame-copy-runtime.mjs`
- Modify: `tools/packaging/verify-linux-frame-copy-runtime.test.mjs`
- Modify: `.github/workflows/build-and-make.yaml`
- Modify: `tools/packaging/configure-linux-frame-copy-build.test.mjs`
- Modify: `docs/architecture/embedded-mpv-native.md`
- Modify: `tools/embedded-mpv/README.md`
- Modify: `docs/superpowers/specs/2026-07-17-linux-embedded-mpv-frame-copy-packaging-design.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a failing extracted-Flatpak regression**

Allow the fixture helper to select the Electron filename:

```js
function createSystemPayload({
    architecture = 'x64',
    electronBinaryName = 'iptvnator.bin',
} = {}) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-layout-')
    );
    const appDir = path.join(root, 'opt', 'IPTVnator');
    const resourceDir = path.join(appDir, 'resources');
    const nativeDir = path.join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    fs.mkdirSync(nativeDir, { recursive: true });
    fs.writeFileSync(
        path.join(appDir, electronBinaryName),
        elfHeader(architecture)
    );

    if (architecture === 'x64') {
        fs.writeFileSync(path.join(nativeDir, 'embedded_mpv.node'), 'addon', {
            mode: 0o644,
        });
        fs.writeFileSync(
            path.join(nativeDir, 'embedded_mpv_frame_reader.node'),
            'reader',
            { mode: 0o644 }
        );
        fs.writeFileSync(
            path.join(nativeDir, 'iptvnator_mpv_helper'),
            'helper',
            { mode: 0o755 }
        );
        fs.writeFileSync(
            path.join(nativeDir, 'embedded-mpv-runtime.json'),
            `${JSON.stringify(SYSTEM_MANIFEST, null, 2)}\n`,
            { mode: 0o644 }
        );
    } else {
        fs.writeFileSync(
            path.join(nativeDir, 'embedded-mpv-unavailable.txt'),
            `Unavailable for ${architecture}\n`
        );
    }

    return { root, appDir, resourceDir, nativeDir };
}
```

Use a foreign-architecture marker fixture so this test isolates launcher
selection without needing a bundled x64 manifest:

```js
test('validates a marker-only Flatpak with an unwrapped Electron ELF', () => {
    const fixture = createSystemPayload({
        architecture: 'arm64',
        electronBinaryName: 'iptvnator',
    });
    try {
        assert.deepEqual(
            verifyExtractedLinuxFrameCopyRuntime({
                resourceDir: fixture.resourceDir,
                artifactFormat: 'flatpak',
                profileName: 'flatpak',
                packageDependencies: [],
                elfInspector: validElfInspector,
                probeRunner() {
                    assert.fail(
                        'foreign Flatpak must not run the helper probe'
                    );
                },
            }),
            []
        );
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});
```

Run:

```bash
node --test --test-name-pattern='marker-only Flatpak with an unwrapped' \
  tools/packaging/verify-linux-frame-copy-runtime.test.mjs
```

Expected: FAIL because the verifier reads `iptvnator.bin`.

- [ ] **Step 2: Resolve every final-artifact Electron path consistently**

Require `resolveLinuxLauncherLayout` and add:

```js
function resolveElectronBinaryPath(resourceDir, artifactFormat) {
    const layout = resolveLinuxLauncherLayout([artifactFormat]);
    return path.join(path.dirname(resourceDir), layout.electronBinaryName);
}
```

Use it in:

- `validateElectronIsolation`;
- `verifyExtractedLinuxFrameCopyRuntime` architecture detection;
- the architecture returned from `verifyLinuxFrameCopyArtifact`.

Keep Snap/AppImage/DEB/RPM/Pacman expectations on `iptvnator.bin`.

- [ ] **Step 3: Add an outer artifact-verifier Flatpak regression**

Create a temporary `.flatpak` file, inject an extractor that writes
`iptvnator` ELF and the marker-only native directory under its supplied
destination, and assert:

```js
assert.deepEqual(
    verifyLinuxFrameCopyArtifact({
        artifactPath,
        profileName: 'flatpak',
        extractArtifact({ destination }) {
            const appDir = path.join(
                destination,
                'files',
                'lib',
                'com.fourgray.iptvnator'
            );
            const resourceDir = path.join(appDir, 'resources');
            const nativeDir = path.join(
                resourceDir,
                'app.asar.unpacked',
                'electron-backend',
                'native'
            );
            fs.mkdirSync(nativeDir, { recursive: true });
            fs.writeFileSync(
                path.join(appDir, 'iptvnator'),
                elfHeader('arm64')
            );
            fs.writeFileSync(
                path.join(nativeDir, 'embedded-mpv-unavailable.txt'),
                'Unavailable for arm64\n'
            );
            return destination;
        },
        metadataReader: () => ({
            declaredArch: 'arm64',
            dependencies: [],
        }),
        elfInspector: validElfInspector,
        probeRunner() {
            assert.fail('foreign Flatpak must not probe');
        },
    }),
    {
        artifactPath: path.resolve(artifactPath),
        format: 'flatpak',
        profileName: 'flatpak',
        architecture: 'arm64',
    }
);
```

- [ ] **Step 4: Invert the installed-Flatpak CI layout assertion**

Inside the existing sandbox shell check:

```bash
LAUNCHER_PATH="$(readlink -f /app/bin/iptvnator)"
test -f "${LAUNCHER_PATH}"
test ! -e "${LAUNCHER_PATH}.bin"
ELF_MAGIC="$(od -An -tx1 -N4 "${LAUNCHER_PATH}" | tr -d "[:space:]")"
test "${ELF_MAGIC}" = "7f454c46"
```

Capture the application-level probe output and fail on the historical Zypak
diagnostics:

```bash
PROBE_OUTPUT="$(
    xvfb-run -a dbus-run-session -- flatpak run \
        --env=LIBGL_ALWAYS_SOFTWARE=1 \
        com.fourgray.iptvnator \
        --embedded-mpv-runtime-probe 2>&1
)"
printf '%s\n' "${PROBE_OUTPUT}"
if printf '%s\n' "${PROBE_OUTPUT}" |
    grep -Eq 'not an ELF file|Zypak needs to be called directly'; then
    echo "::error::Flatpak launched a wrapper instead of the Electron ELF."
    exit 1
fi
```

Update `configure-linux-frame-copy-build.test.mjs` to require the ELF magic
check, `.bin` rejection, warning guard, and absence of the old wrapper-marker
greps.

- [ ] **Step 5: Update canonical launcher documentation**

Document the exact invariant in all listed documentation:

```text
Flatpak is an isolated packaging pass and keeps `iptvnator` as the real
Electron ELF so Electron Builder's `electron-wrapper` passes it directly to
Zypak. Other Linux targets retain the conditional `iptvnator` wrapper and
`iptvnator.bin`. Mixed Flatpak/non-Flatpak target sets fail before mutation.
```

In the earlier frame-copy design, replace the unconditional
`Electron executable (iptvnator.bin)` wording with
`iptvnator for Flatpak; iptvnator.bin for other Linux targets`.

- [ ] **Step 6: Run targeted tests and formatting**

```bash
node --test --test-name-pattern='Flatpak|Linux CI verifies' \
  tools/packaging/verify-linux-frame-copy-runtime.test.mjs \
  tools/packaging/configure-linux-frame-copy-build.test.mjs
pnpm prettier --check \
  tools/packaging/verify-linux-frame-copy-runtime.mjs \
  tools/packaging/verify-linux-frame-copy-runtime.test.mjs \
  tools/packaging/configure-linux-frame-copy-build.test.mjs \
  .github/workflows/build-and-make.yaml \
  docs/architecture/embedded-mpv-native.md \
  tools/embedded-mpv/README.md \
  docs/superpowers/specs/2026-07-17-linux-embedded-mpv-frame-copy-packaging-design.md \
  AGENTS.md CLAUDE.md
```

Expected: tests and formatting PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add tools/packaging/verify-linux-frame-copy-runtime.mjs \
  tools/packaging/verify-linux-frame-copy-runtime.test.mjs \
  .github/workflows/build-and-make.yaml \
  tools/packaging/configure-linux-frame-copy-build.test.mjs \
  docs/architecture/embedded-mpv-native.md \
  tools/embedded-mpv/README.md \
  docs/superpowers/specs/2026-07-17-linux-embedded-mpv-frame-copy-packaging-design.md \
  AGENTS.md CLAUDE.md
git commit -m "test(packaging): enforce direct Flatpak Zypak launch"
```

### Task 4: Verify the integrated fix

**Files:**

- Verify only; do not add unrelated changes.

- [ ] **Step 1: Run the complete packaging tests**

```bash
pnpm nx test packaging --skip-nx-cache
```

Expected: all tests PASS, including the new launcher tests.

- [ ] **Step 2: Run packaging lint**

```bash
pnpm nx lint packaging --skip-nx-cache
```

Expected: zero ESLint errors.

- [ ] **Step 3: Run repository formatting checks for changed files**

```bash
pnpm prettier --check \
  tools/packaging/linux-launcher-layout.cjs \
  tools/packaging/linux-after-pack.cjs \
  tools/packaging/linux-after-pack.test.mjs \
  tools/packaging/electron-after-pack.cjs \
  tools/packaging/embedded-mpv-packaging.cjs \
  tools/packaging/embedded-mpv-arch.test.mjs \
  tools/packaging/verify-electron-package-layout.mjs \
  tools/packaging/electron-package-identity.test.mjs \
  tools/packaging/verify-linux-frame-copy-runtime.mjs \
  tools/packaging/verify-linux-frame-copy-runtime.test.mjs \
  tools/packaging/configure-linux-frame-copy-build.test.mjs \
  tools/packaging/project.json \
  .github/workflows/build-and-make.yaml \
  docs/architecture/embedded-mpv-native.md \
  tools/embedded-mpv/README.md \
  docs/superpowers/specs/2026-07-17-linux-embedded-mpv-frame-copy-packaging-design.md \
  docs/superpowers/specs/2026-07-18-flatpak-zypak-launcher-design.md \
  docs/superpowers/plans/2026-07-18-flatpak-zypak-launcher.md \
  AGENTS.md CLAUDE.md
```

Expected: all changed files use repository formatting.

- [ ] **Step 4: Inspect the final diff**

```bash
git diff 8fdac824..HEAD --check
git status --short
```

Expected: no whitespace errors and only scoped launcher, validator, CI, test,
plan, and documentation changes.
