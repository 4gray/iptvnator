const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    copyRuntimeToNativeBuild,
    findLibMpv,
    patchAddonForBundledRuntime,
    validateNoForbiddenRuntimeLinks,
} = require('../../tools/packaging/embedded-mpv-packaging.cjs');
const {
    removeStaleFrameCopyArtifacts,
} = require('../../tools/packaging/embedded-mpv-frame-copy-files.cjs');
const {
    isLinuxSystemBuildInputManifest,
    validateLinuxRuntimeManifest,
    validateLinuxSystemBuildInputManifest,
} = require('../../tools/embedded-mpv/linux-runtime-manifest.cjs');
const {
    resolveVerifiedLinuxLibMpvSoname,
    runWithCleanup,
    validateLinuxFrameCopyLinkage,
} = require('./embedded-mpv-linux-linkage.cjs');

const LINUX_PACKAGE_RUNTIME_MODES = Object.freeze(['system', 'bundled']);
const LINUX_STAGED_RUNTIME_ORIGIN = 'vendored-lgpl';
const LINUX_SOURCE_RUNTIME_ORIGIN = 'vendored-lgpl-source-build';

const workspaceRoot = process.cwd();
const addonRoot = path.join(
    workspaceRoot,
    'apps',
    'electron-backend',
    'native'
);
const outputDir = path.join(addonRoot, 'build', 'Release');
const outputFile = path.join(outputDir, 'embedded_mpv.node');
const outputLibDir = path.join(outputDir, 'lib');
const distNativeDir = path.join(
    workspaceRoot,
    'dist',
    'apps',
    'electron-backend',
    'native'
);
const unavailableMarkerFile = path.join(
    outputDir,
    'embedded-mpv-unavailable.txt'
);
const homebrewIncludeDir = '/opt/homebrew/include';
const homebrewLibDir = '/opt/homebrew/lib';
const targetPlatform =
    process.env.IPTVNATOR_EMBEDDED_MPV_PLATFORM || process.platform;
const targetArch =
    process.env.IPTVNATOR_EMBEDDED_MPV_ARCH ||
    process.env.npm_config_arch ||
    process.arch;
const vendoredRuntimeRoot = path.join(
    workspaceRoot,
    'vendor',
    'embedded-mpv',
    `${targetPlatform}-${targetArch}`
);
const vendoredIncludeDir = path.join(vendoredRuntimeRoot, 'include');
const vendoredLibDir = path.join(vendoredRuntimeRoot, 'lib');
const vendoredBinDir = path.join(vendoredRuntimeRoot, 'bin');
const homebrewFallbackEnabled =
    process.env.IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW === '1';
const embeddedMpvRequired = ['1', 'true', 'yes', 'on'].includes(
    (process.env.IPTVNATOR_REQUIRE_EMBEDDED_MPV ?? '').trim().toLowerCase()
);

function log(message) {
    process.stdout.write(`[embedded-mpv] ${message}\n`);
}

function cleanOutput() {
    fs.rmSync(outputFile, { force: true });
    fs.rmSync(outputLibDir, { recursive: true, force: true });
    // Do not let an optional/skipped rebuild leave frame-copy artifacts that
    // could make startup treat an incomplete runtime as available.
    removeStaleFrameCopyArtifacts(outputDir);
    for (const windowsDllName of [
        'mpv-2.dll',
        'libmpv-2.dll',
        'mpv.dll',
        'libmpv.dll',
    ]) {
        fs.rmSync(path.join(outputDir, windowsDllName), { force: true });
    }
    fs.rmSync(path.join(outputDir, '.deps'), { recursive: true, force: true });
    fs.rmSync(path.join(outputDir, 'obj.target'), {
        recursive: true,
        force: true,
    });
    fs.rmSync(path.join(outputDir, 'embedded-mpv-runtime.json'), {
        force: true,
    });
    fs.writeFileSync(
        unavailableMarkerFile,
        'Embedded MPV native runtime is not available for this build.\n'
    );
}

function cleanNativeBuildIntermediates() {
    fs.rmSync(outputFile, { force: true });
    fs.rmSync(path.join(outputDir, '.deps'), { recursive: true, force: true });
    fs.rmSync(path.join(outputDir, 'obj.target'), {
        recursive: true,
        force: true,
    });
}

function cleanDistNativeOutput() {
    fs.rmSync(distNativeDir, { recursive: true, force: true });
}

function readRuntimeManifest(runtimeRoot) {
    const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return {};
    }

    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function validatedLinuxSourceRuntime(runtimeRoot) {
    const stagedManifest = readRuntimeManifest(runtimeRoot);
    if (
        stagedManifest === null ||
        typeof stagedManifest !== 'object' ||
        Array.isArray(stagedManifest)
    ) {
        throw new Error(
            `Staged Linux runtime manifest must be an object: ${path.join(
                runtimeRoot,
                'runtime-manifest.json'
            )}`
        );
    }

    const envelopeErrors = [];
    if (stagedManifest.origin !== LINUX_STAGED_RUNTIME_ORIGIN) {
        envelopeErrors.push(`origin must be "${LINUX_STAGED_RUNTIME_ORIGIN}"`);
    }
    if (stagedManifest.platform !== 'linux') {
        envelopeErrors.push('platform must be "linux"');
    }
    if (stagedManifest.arch !== targetArch) {
        envelopeErrors.push(`arch must be "${targetArch}"`);
    }
    if (
        typeof stagedManifest.stagedAt !== 'string' ||
        stagedManifest.stagedAt.trim().length === 0
    ) {
        envelopeErrors.push('stagedAt must be a non-empty string');
    }
    if (!Array.isArray(stagedManifest.runtimeFiles)) {
        envelopeErrors.push('runtimeFiles must be an array');
    }

    const systemBuildInputs = isLinuxSystemBuildInputManifest(stagedManifest);
    let buildInputMode;
    let sourceRuntimeManifest;
    if (systemBuildInputs) {
        buildInputMode = 'system-build-inputs';
        sourceRuntimeManifest = {
            linuxBackend: stagedManifest.linuxBackend,
            buildInputs: stagedManifest.buildInputs,
            sourceDistribution: stagedManifest.sourceDistribution,
        };
        if (
            Array.isArray(stagedManifest.runtimeFiles) &&
            stagedManifest.runtimeFiles.length !== 0
        ) {
            envelopeErrors.push(
                'system build inputs must not declare staged runtime files'
            );
        }
        if (stagedManifest.sourceBuildOrigin !== undefined) {
            envelopeErrors.push(
                'system build inputs must not declare sourceBuildOrigin'
            );
        }
    } else {
        buildInputMode = 'bundled-runtime';
        const sourceBuildOrigin = stagedManifest.sourceBuildOrigin;
        const sourceMetadata = { ...stagedManifest };
        delete sourceMetadata.sourceBuildOrigin;
        delete sourceMetadata.stagedAt;
        sourceRuntimeManifest = {
            ...sourceMetadata,
            origin: sourceBuildOrigin,
        };
        if (sourceBuildOrigin !== LINUX_SOURCE_RUNTIME_ORIGIN) {
            envelopeErrors.push(
                `sourceBuildOrigin must be "${LINUX_SOURCE_RUNTIME_ORIGIN}"`
            );
        }
    }

    const sourceManifestErrors =
        buildInputMode === 'system-build-inputs'
            ? validateLinuxSystemBuildInputManifest(sourceRuntimeManifest)
            : validateLinuxRuntimeManifest(sourceRuntimeManifest);
    const declaredRuntimeFileNames = Array.isArray(
        sourceRuntimeManifest.runtimeFiles
    )
        ? sourceRuntimeManifest.runtimeFiles
              .map((runtimeFile) => runtimeFile.name)
              .sort()
        : [];
    const stagedRuntimeFileNames = listRuntimeFiles(
        path.join(runtimeRoot, 'lib'),
        runtimeFilePredicate
    )
        .map((runtimeFile) => path.basename(runtimeFile))
        .sort();
    if (
        JSON.stringify(stagedRuntimeFileNames) !==
        JSON.stringify(declaredRuntimeFileNames)
    ) {
        envelopeErrors.push(
            'staged lib directory must exactly match manifest runtimeFiles'
        );
    }

    const errors = [...envelopeErrors, ...sourceManifestErrors];
    if (errors.length > 0) {
        throw new Error(
            [
                `Invalid staged Linux runtime at ${runtimeRoot}:`,
                ...errors.map((error) => `- ${error}`),
            ].join('\n')
        );
    }

    return {
        buildInputMode,
        sourceRuntimeManifest,
        sourceRuntimeValidated: buildInputMode === 'bundled-runtime',
    };
}

function fileExists(filePath) {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function listRuntimeFiles(runtimeDir, predicate) {
    if (!runtimeDir || !fs.existsSync(runtimeDir)) {
        return [];
    }

    return fs
        .readdirSync(runtimeDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() || entry.isSymbolicLink())
        .map((entry) => path.join(runtimeDir, entry.name))
        .filter((filePath) => {
            try {
                return fs.statSync(filePath).isFile();
            } catch {
                return false;
            }
        })
        .filter(predicate)
        .sort();
}

function runtimeFilePredicate(filePath) {
    const fileName = path.basename(filePath);

    switch (targetPlatform) {
        case 'darwin':
            return fileName.endsWith('.dylib');
        case 'win32':
            return (
                fileName.endsWith('.dll') ||
                fileName.endsWith('.lib') ||
                fileName.endsWith('.dll.a')
            );
        case 'linux':
            return /\.so(?:\.\d+)*$/.test(fileName);
        default:
            return false;
    }
}

function findWindowsImportLib(libDir) {
    for (const candidate of ['mpv.lib', 'mpv-2.lib', 'libmpv.dll.a']) {
        const candidatePath = path.join(libDir, candidate);
        if (fileExists(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
}

function findWindowsLibMpv(runtimeRoot) {
    for (const candidate of [
        path.join(runtimeRoot, 'lib', 'mpv-2.dll'),
        path.join(runtimeRoot, 'bin', 'mpv-2.dll'),
        path.join(runtimeRoot, 'lib', 'libmpv-2.dll'),
        path.join(runtimeRoot, 'bin', 'libmpv-2.dll'),
        path.join(runtimeRoot, 'lib', 'mpv.dll'),
        path.join(runtimeRoot, 'bin', 'mpv.dll'),
        path.join(runtimeRoot, 'lib', 'libmpv.dll'),
        path.join(runtimeRoot, 'bin', 'libmpv.dll'),
    ]) {
        if (fileExists(candidate)) {
            return candidate;
        }
    }

    return null;
}

/* Debian/Ubuntu install linker targets under the multiarch triple dir. The
 * compiler's built-in search paths cover it for -l resolution either way;
 * this keeps the -L flag and the helper's baked rpath pointing somewhere
 * real. */
function defaultLinuxSystemLibDir() {
    const multiarchTriples = {
        arm: 'arm-linux-gnueabihf',
        arm64: 'aarch64-linux-gnu',
        x64: 'x86_64-linux-gnu',
    };
    const triple = multiarchTriples[targetArch];
    if (triple && fs.existsSync(`/usr/lib/${triple}`)) {
        return `/usr/lib/${triple}`;
    }
    return '/usr/lib';
}

function findLinuxLibMpv(libDir) {
    for (const candidate of ['libmpv.so.2', 'libmpv.so.1', 'libmpv.so']) {
        const candidatePath = path.join(libDir, candidate);
        if (fileExists(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
}

function resolveRuntime() {
    const vendoredHeader = path.join(vendoredIncludeDir, 'mpv', 'client.h');
    const stagedLinuxRuntime =
        targetPlatform === 'linux' && fs.existsSync(vendoredHeader)
            ? validatedLinuxSourceRuntime(vendoredRuntimeRoot)
            : null;
    const vendoredLibMpv =
        targetPlatform === 'darwin'
            ? findLibMpv(vendoredLibDir)
            : targetPlatform === 'win32'
              ? findWindowsLibMpv(vendoredRuntimeRoot)
              : targetPlatform === 'linux'
                ? stagedLinuxRuntime
                : null;

    if (vendoredLibMpv && fs.existsSync(vendoredHeader)) {
        const windowsImportLib =
            targetPlatform === 'win32'
                ? findWindowsImportLib(vendoredLibDir)
                : null;
        if (targetPlatform === 'win32' && !windowsImportLib) {
            return null;
        }

        return {
            origin: 'vendored-lgpl',
            includeDir: vendoredIncludeDir,
            libDir: vendoredLibDir,
            binDir: vendoredBinDir,
            manifest: readRuntimeManifest(vendoredRuntimeRoot),
            windowsImportLib,
            ...(stagedLinuxRuntime ?? {}),
        };
    }

    if (targetPlatform === 'linux') {
        // Dev-first Linux flow (frame-copy helper links system libmpv): a
        // distro libmpv-dev install is a full runtime — no staging needed.
        // LIBMPV_INCLUDE_DIR / LINUX_NATIVE_LIBRARY_DIR override the system
        // paths for machines with a local (non-root) libmpv prefix.
        const systemIncludeDir =
            process.env.LIBMPV_INCLUDE_DIR || '/usr/include';
        if (fs.existsSync(path.join(systemIncludeDir, 'mpv', 'client.h'))) {
            const sourceRuntimeManifest = {
                linuxBackend: 'process-isolated mpv --wid',
                warning: 'Development-only unmanaged system libmpv toolchain.',
            };
            return {
                origin: 'system-dev',
                includeDir: systemIncludeDir,
                libDir:
                    process.env.LINUX_NATIVE_LIBRARY_DIR ||
                    defaultLinuxSystemLibDir(),
                binDir: undefined,
                manifest: sourceRuntimeManifest,
                buildInputMode: 'system-dev',
                sourceRuntimeManifest,
                sourceRuntimeValidated: false,
                windowsImportLib: null,
            };
        }
    }

    if (targetPlatform === 'darwin' && homebrewFallbackEnabled) {
        const homebrewLibMpv = findLibMpv(homebrewLibDir);
        const homebrewHeader = path.join(homebrewIncludeDir, 'mpv', 'client.h');
        if (homebrewLibMpv && fs.existsSync(homebrewHeader)) {
            log(
                'Using Homebrew libmpv as a development-only fallback. Release packaging will reject this runtime.'
            );
            return {
                origin: 'homebrew-dev',
                includeDir: homebrewIncludeDir,
                libDir: homebrewLibDir,
                binDir: undefined,
                manifest: {
                    warning:
                        'Development-only runtime. Do not ship this in release artifacts.',
                },
                windowsImportLib: null,
            };
        }
    }

    return null;
}

function hasStagedLinuxLibMpvLinkerInput(runtime) {
    return (
        Array.isArray(runtime.sourceRuntimeManifest?.runtimeFiles) &&
        runtime.sourceRuntimeManifest.runtimeFiles.some(
            (runtimeFile) => runtimeFile.name === 'libmpv.so'
        )
    );
}

function assertRequiredLinuxFrameCopyRuntime(runtime) {
    if (targetPlatform !== 'linux' || !embeddedMpvRequired) {
        return;
    }

    if (
        runtime.buildInputMode !== 'bundled-runtime' ||
        runtime.sourceRuntimeValidated !== true ||
        !hasStagedLinuxLibMpvLinkerInput(runtime)
    ) {
        cleanOutput();
        throw new Error(
            'Required Linux builds must use the validated bundled source runtime containing staged libmpv.'
        );
    }
}

function copyLinuxRuntimeClosureToNativeBuild(runtime) {
    fs.rmSync(outputLibDir, { recursive: true, force: true });

    const declaredRuntimeFiles =
        runtime.buildInputMode === 'bundled-runtime'
            ? runtime.sourceRuntimeManifest.runtimeFiles
            : [];
    if (declaredRuntimeFiles.length === 0) {
        return [];
    }

    fs.mkdirSync(outputLibDir, { recursive: true });
    const copiedRuntimeFiles = [];
    for (const runtimeFile of declaredRuntimeFiles) {
        const sourcePath = path.join(runtime.libDir, runtimeFile.name);
        let descriptor;
        try {
            descriptor = fs.openSync(
                sourcePath,
                fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
            );
            const stat = fs.fstatSync(descriptor);
            if (!stat.isFile()) {
                throw new Error(
                    `Staged Linux runtime path is not a regular file: ${sourcePath}`
                );
            }

            const contents = fs.readFileSync(descriptor);
            if (contents.byteLength !== runtimeFile.size) {
                throw new Error(
                    `Size mismatch for staged Linux runtime file ${runtimeFile.name}: expected ${runtimeFile.size}, received ${contents.byteLength}.`
                );
            }
            const actualSha256 = crypto
                .createHash('sha256')
                .update(contents)
                .digest('hex');
            if (actualSha256 !== runtimeFile.sha256) {
                throw new Error(
                    `SHA-256 mismatch for staged Linux runtime file ${runtimeFile.name}: expected ${runtimeFile.sha256}, received ${actualSha256}.`
                );
            }

            const destinationPath = path.join(outputLibDir, runtimeFile.name);
            fs.writeFileSync(destinationPath, contents, { mode: 0o755 });
            copiedRuntimeFiles.push({ ...runtimeFile });
        } finally {
            if (descriptor !== undefined) {
                fs.closeSync(descriptor);
            }
        }
    }

    return copiedRuntimeFiles;
}

function writeLinuxFrameCopyBuildManifest(runtime) {
    const copiedRuntimeFiles = copyLinuxRuntimeClosureToNativeBuild(runtime);
    const libmpvSoname =
        runtime.sourceRuntimeValidated === true &&
        runtime.buildInputMode === 'bundled-runtime' &&
        copiedRuntimeFiles.length > 0
            ? resolveVerifiedLinuxLibMpvSoname({
                  outputLibDir,
                  runtimeFiles: copiedRuntimeFiles,
                  runtimeDependencyClosure:
                      runtime.sourceRuntimeManifest.runtimeDependencyClosure,
                  readDynamicSection: readLinuxDynamicSection,
              })
            : null;
    const packageRuntimeAvailable =
        runtime.sourceRuntimeValidated === true &&
        runtime.buildInputMode === 'bundled-runtime' &&
        copiedRuntimeFiles.length > 0 &&
        libmpvSoname !== null;
    const manifest = {
        schemaVersion: 1,
        origin: 'linux-frame-copy-build',
        generatedAt: new Date().toISOString(),
        platform: targetPlatform,
        arch: targetArch,
        buildInputMode: runtime.buildInputMode,
        sourceRuntimeValidated: runtime.sourceRuntimeValidated,
        allowedPackageRuntimeModes: [...LINUX_PACKAGE_RUNTIME_MODES],
        packageRuntimeAvailability: {
            system: packageRuntimeAvailable,
            bundled: packageRuntimeAvailable,
        },
        artifacts: {
            addon: 'embedded_mpv.node',
            frameReader: 'embedded_mpv_frame_reader.node',
            helper: 'iptvnator_mpv_helper',
        },
        processIsolation: {
            addonLoadsLibmpv: false,
            helperLinksLibmpv: true,
            helperRunpath: ['$ORIGIN/lib'],
        },
        nativeViewFallback: 'process-isolated mpv --wid',
        libmpvSoname,
        runtimeFiles: copiedRuntimeFiles,
        runtimeTotalBytes: copiedRuntimeFiles.reduce(
            (total, runtimeFile) => total + runtimeFile.size,
            0
        ),
        sourceRuntime: runtime.sourceRuntimeManifest,
    };

    fs.writeFileSync(
        path.join(outputDir, 'embedded-mpv-runtime.json'),
        `${JSON.stringify(manifest, null, 2)}\n`
    );

    return manifest;
}

function copyFile(sourcePath, destinationPath) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
    fs.chmodSync(destinationPath, 0o755);
}

function copyGenericRuntimeToNativeBuild(runtime) {
    fs.rmSync(outputLibDir, { recursive: true, force: true });
    fs.mkdirSync(outputLibDir, { recursive: true });

    const runtimeFiles = [
        ...listRuntimeFiles(runtime.libDir, runtimeFilePredicate),
        ...listRuntimeFiles(runtime.binDir, runtimeFilePredicate),
    ];
    const copiedFiles = new Set();

    for (const runtimeFile of runtimeFiles) {
        const fileName = path.basename(runtimeFile);
        if (copiedFiles.has(fileName)) {
            continue;
        }
        copyFile(runtimeFile, path.join(outputLibDir, fileName));
        copiedFiles.add(fileName);
    }

    if (targetPlatform === 'win32') {
        for (const fileName of copiedFiles) {
            if (fileName.endsWith('.dll')) {
                copyFile(
                    path.join(outputLibDir, fileName),
                    path.join(outputDir, fileName)
                );
            }
        }
    }

    if (targetPlatform === 'linux') {
        const libMpvPath = findLinuxLibMpv(outputLibDir);
        if (libMpvPath && path.basename(libMpvPath) !== 'libmpv.so') {
            copyFile(libMpvPath, path.join(outputLibDir, 'libmpv.so'));
            copiedFiles.add('libmpv.so');
        }
    }

    const manifest = {
        origin: runtime.origin,
        generatedAt: new Date().toISOString(),
        libDir: 'lib',
        runtimeFiles: [...copiedFiles].sort(),
        ...runtime.manifest,
        platform: targetPlatform,
        targetArch,
    };

    fs.writeFileSync(
        path.join(outputDir, 'embedded-mpv-runtime.json'),
        `${JSON.stringify(manifest, null, 2)}\n`
    );

    return manifest;
}

function resolveElectronNodeGypBin() {
    const pnpmRoot = path.join(workspaceRoot, 'node_modules', '.pnpm');

    if (!fs.existsSync(pnpmRoot)) {
        throw new Error('Unable to find node_modules/.pnpm.');
    }

    const packageDirs = fs
        .readdirSync(pnpmRoot, { withFileTypes: true })
        .filter(
            (entry) =>
                entry.isDirectory() &&
                entry.name.startsWith('@electron+node-gyp@')
        )
        .map((entry) => entry.name)
        .sort();

    for (const packageDir of packageDirs) {
        const candidate = path.join(
            pnpmRoot,
            packageDir,
            'node_modules',
            '@electron',
            'node-gyp',
            'bin',
            'node-gyp.js'
        );

        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error('Unable to resolve @electron/node-gyp.');
}

function runNodeGyp(command, env) {
    const nodeGypBin = resolveElectronNodeGypBin();
    const result = spawnSync(
        process.execPath,
        [nodeGypBin, command, '--directory', addonRoot],
        {
            cwd: workspaceRoot,
            env,
            stdio: 'inherit',
        }
    );

    if (result.status !== 0) {
        throw new Error(
            `node-gyp ${command} failed with status ${result.status ?? 1}.`
        );
    }
}

function readLinuxDynamicSection(filePath) {
    const result = spawnSync('readelf', ['-d', filePath], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
        throw new Error(
            `Unable to run readelf for ${filePath}: ${result.error.message}`
        );
    }
    if (result.status !== 0) {
        throw new Error(
            `readelf -d failed for ${filePath} with status ${
                result.status ?? 1
            }: ${(result.stderr ?? '').trim()}`
        );
    }
    return result.stdout;
}

function main() {
    fs.mkdirSync(outputDir, { recursive: true });
    cleanDistNativeOutput();
    cleanOutput();

    if (targetPlatform !== process.platform) {
        if (embeddedMpvRequired) {
            throw new Error(
                `Embedded MPV is required for ${targetPlatform}-${targetArch}, but this host is ${process.platform}-${process.arch}.`
            );
        }
        log(
            `Skipping build for ${targetPlatform}-${targetArch} on ${process.platform}-${process.arch}.`
        );
        return;
    }

    const runtime = resolveRuntime();
    if (!runtime) {
        cleanOutput();
        const message = [
            `Skipping build because no embedded MPV runtime was found for ${targetPlatform}-${targetArch}.`,
            `Expected vendored runtime at ${vendoredRuntimeRoot}.`,
            targetPlatform === 'linux'
                ? 'Stage Linux MPV build inputs before requiring Embedded MPV on this platform.'
                : targetPlatform === 'darwin'
                  ? 'For local development only, set IPTVNATOR_EMBEDDED_MPV_ALLOW_HOMEBREW=1 to use Homebrew libmpv.'
                  : 'Stage a vendored LGPL-compatible runtime before requiring Embedded MPV on this platform.',
        ].join('\n');
        if (embeddedMpvRequired) {
            throw new Error(message);
        }

        log(message);
        return;
    }

    assertRequiredLinuxFrameCopyRuntime(runtime);

    const buildNativeArtifacts = () => {
        const runtimeManifest =
            targetPlatform === 'darwin'
                ? copyRuntimeToNativeBuild({
                      runtimeLibDir: runtime.libDir,
                      outputLibDir,
                      runtimeOrigin: runtime.origin,
                      runtimeManifest: {
                          targetArch,
                          ...runtime.manifest,
                      },
                  })
                : targetPlatform === 'linux'
                  ? writeLinuxFrameCopyBuildManifest(runtime)
                  : copyGenericRuntimeToNativeBuild(runtime);

        const electronPackageJson = require(
            path.join(workspaceRoot, 'node_modules', 'electron', 'package.json')
        );
        const electronVersion = electronPackageJson.version;
        const env = {
            ...process.env,
            npm_config_runtime: 'electron',
            npm_config_target: electronVersion,
            npm_config_arch: targetArch,
            npm_config_disturl: 'https://electronjs.org/headers',
            npm_config_build_from_source: 'true',
            npm_config_update_binary: 'false',
            LIBMPV_INCLUDE_DIR: runtime.includeDir,
            ...(targetPlatform === 'linux'
                ? {
                      LINUX_VERIFIED_RUNTIME_LIBRARY_DIR: outputLibDir,
                  }
                : { LIBMPV_LIBRARY_DIR: outputLibDir }),
            ...(runtime.windowsImportLib
                ? {
                      LIBMPV_IMPORT_LIB: path.join(
                          outputLibDir,
                          path.basename(runtime.windowsImportLib)
                      ),
                  }
                : {}),
        };

        log(
            `Building native addon against Electron ${electronVersion} using ${runtime.origin} runtime for ${targetPlatform}-${targetArch}...`
        );
        cleanNativeBuildIntermediates();
        runNodeGyp('configure', env);
        runNodeGyp('build', env);

        if (!fs.existsSync(outputFile)) {
            throw new Error(`Build finished without producing ${outputFile}.`);
        }

        if (targetPlatform === 'linux') {
            validateLinuxFrameCopyLinkage({
                expectedLibmpvSoname: runtimeManifest.libmpvSoname,
                outputDir,
                readDynamicSection: readLinuxDynamicSection,
            });
        }

        if (targetPlatform === 'darwin') {
            patchAddonForBundledRuntime(outputFile, outputLibDir);
            // The frame-copy helper executable links libmpv too and sits next
            // to the same lib/ directory, so it gets the identical
            // dependency-path rewrite + ad-hoc re-sign.
            const frameHelperFile = path.join(
                outputDir,
                'iptvnator_mpv_helper'
            );
            if (fs.existsSync(frameHelperFile)) {
                patchAddonForBundledRuntime(frameHelperFile, outputLibDir);
            }
            const forbiddenLinkErrors = validateNoForbiddenRuntimeLinks([
                outputFile,
                ...(fs.existsSync(frameHelperFile) ? [frameHelperFile] : []),
                ...runtimeManifest.dylibs.map((dylib) =>
                    path.join(outputLibDir, dylib)
                ),
            ]);
            if (
                runtime.origin === 'vendored-lgpl' &&
                forbiddenLinkErrors.length > 0
            ) {
                throw new Error(forbiddenLinkErrors.join('\n'));
            }
        }

        fs.rmSync(unavailableMarkerFile, { force: true });
    };

    try {
        runWithCleanup(buildNativeArtifacts, cleanOutput);
    } catch (error) {
        if (!embeddedMpvRequired && runtime.origin === 'system-dev') {
            // The system-dev fallback triggers on any machine with
            // libmpv-dev installed; keep the old graceful-skip contract
            // when the rest of the toolchain (EGL/GL/gbm dev packages) is
            // missing instead of failing the whole electron build.
            log(
                `Embedded MPV native build failed with the system-dev toolchain; continuing without embedded MPV. ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return;
        }
        throw error;
    }

    log(`Built ${path.relative(workspaceRoot, outputFile)}.`);
}

try {
    main();
} catch (error) {
    process.stderr.write(
        `[embedded-mpv] ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
}
