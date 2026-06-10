const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    copyRuntimeToNativeBuild,
    findLibMpv,
    patchAddonForBundledRuntime,
    validateNoForbiddenRuntimeLinks,
} = require('../../tools/packaging/embedded-mpv-packaging.cjs');

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
    for (const windowsDllName of ['mpv-2.dll', 'mpv.dll']) {
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
            return fileName.endsWith('.dll') || fileName.endsWith('.lib');
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
        path.join(runtimeRoot, 'lib', 'mpv.dll'),
        path.join(runtimeRoot, 'bin', 'mpv.dll'),
    ]) {
        if (fileExists(candidate)) {
            return candidate;
        }
    }

    return null;
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
    const vendoredLibMpv =
        targetPlatform === 'darwin'
            ? findLibMpv(vendoredLibDir)
            : targetPlatform === 'win32'
              ? findWindowsLibMpv(vendoredRuntimeRoot)
              : targetPlatform === 'linux'
                ? true
                : null;
    const vendoredHeader = path.join(vendoredIncludeDir, 'mpv', 'client.h');

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
        };
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

function writeLinuxProcessRuntimeManifest(runtime) {
    fs.rmSync(outputLibDir, { recursive: true, force: true });

    const manifest = {
        ...runtime.manifest,
        origin: 'external-mpv-process',
        generatedAt: new Date().toISOString(),
        runtimeFiles: [],
        linuxBackend:
            runtime.manifest.linuxBackend ?? 'process-isolated mpv --wid',
        mpvExecutable: 'mpv',
        platform: targetPlatform,
        targetArch,
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

function main() {
    fs.mkdirSync(outputDir, { recursive: true });
    cleanDistNativeOutput();

    if (targetPlatform !== process.platform) {
        cleanOutput();
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
              ? writeLinuxProcessRuntimeManifest(runtime)
              : copyGenericRuntimeToNativeBuild(runtime);
    fs.rmSync(unavailableMarkerFile, { force: true });

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
            ? { LINUX_NATIVE_LIBRARY_DIR: runtime.libDir }
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

    if (targetPlatform === 'darwin') {
        patchAddonForBundledRuntime(outputFile, outputLibDir);
        const forbiddenLinkErrors = validateNoForbiddenRuntimeLinks([
            outputFile,
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
