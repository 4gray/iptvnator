const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const forbiddenRuntimePathPrefixes = ['/opt/homebrew/', '/usr/local/'];
const systemRuntimePathPrefixes = ['/System/Library/', '/usr/lib/'];

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        stdio: options.stdio ?? 'pipe',
        encoding: 'utf8',
        ...options,
    });

    if (result.status !== 0) {
        const stderr = result.stderr ? `\n${result.stderr}` : '';
        throw new Error(
            `${command} ${args.join(' ')} failed with status ${result.status ?? 1}.${stderr}`
        );
    }

    return result.stdout ?? '';
}

function commandExists(command) {
    const result = spawnSync('sh', ['-lc', `command -v ${command}`], {
        stdio: 'ignore',
    });
    return result.status === 0;
}

function ensureDir(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
}

function removeDir(directoryPath) {
    fs.rmSync(directoryPath, { recursive: true, force: true });
}

function copyFile(sourcePath, destinationPath) {
    ensureDir(path.dirname(destinationPath));
    fs.copyFileSync(sourcePath, destinationPath);
    fs.chmodSync(destinationPath, 0o755);
}

function listDylibs(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        return [];
    }

    return fs
        .readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.dylib'))
        .map((entry) => path.join(directoryPath, entry.name))
        .sort();
}

function listRuntimeFiles(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        return [];
    }

    return fs
        .readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(directoryPath, entry.name))
        .sort();
}

function parseOtoolDependencies(binaryPath) {
    const output = run('otool', ['-L', binaryPath]);
    return output
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(/\s+\(/)[0])
        .filter(Boolean);
}

function parseOtoolRpaths(binaryPath) {
    const output = run('otool', ['-l', binaryPath]);
    const lines = output.split(/\r?\n/);
    const rpaths = [];

    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].trim() !== 'cmd LC_RPATH') {
            continue;
        }

        for (let offset = index + 1; offset < lines.length; offset += 1) {
            const match = lines[offset]
                .trim()
                .match(/^path\s+(.+?)\s+\(offset\s+\d+\)$/);
            if (match) {
                rpaths.push(match[1]);
                break;
            }
        }
    }

    return rpaths;
}

function readInstallNameId(binaryPath) {
    const result = spawnSync('otool', ['-D', binaryPath], {
        stdio: 'pipe',
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        return null;
    }

    return (
        result.stdout
            .split(/\r?\n/)
            .slice(1)
            .map((line) => line.trim())
            .find(Boolean) ?? null
    );
}

function isSystemDependency(dependencyPath) {
    return systemRuntimePathPrefixes.some((prefix) =>
        dependencyPath.startsWith(prefix)
    );
}

function isForbiddenDependency(dependencyPath) {
    return forbiddenRuntimePathPrefixes.some((prefix) =>
        dependencyPath.startsWith(prefix)
    );
}

function resolvePathToken(tokenPath, binaryPath) {
    if (tokenPath.startsWith('@loader_path/')) {
        return path.resolve(
            path.dirname(binaryPath),
            tokenPath.replace('@loader_path/', '')
        );
    }

    if (tokenPath.startsWith('@executable_path/')) {
        return null;
    }

    if (tokenPath.startsWith('@rpath/')) {
        return null;
    }

    return tokenPath;
}

function resolveRpathDependency(dependencyPath, binaryPath) {
    const dependencyName = dependencyPath.replace('@rpath/', '');

    for (const rpath of parseOtoolRpaths(binaryPath)) {
        const resolvedRpath = resolvePathToken(rpath, binaryPath);
        if (!resolvedRpath) {
            continue;
        }

        const candidatePath = path.resolve(resolvedRpath, dependencyName);
        if (fs.existsSync(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
}

function resolveDependencyPath(dependencyPath, binaryPath) {
    if (dependencyPath.startsWith('@loader_path/')) {
        return resolvePathToken(dependencyPath, binaryPath);
    }

    if (dependencyPath.startsWith('@rpath/')) {
        return resolveRpathDependency(dependencyPath, binaryPath);
    }

    if (dependencyPath.startsWith('@executable_path/')) {
        return null;
    }

    return dependencyPath;
}

function collectExternalDylibs(entryPaths) {
    const visited = new Set();
    const queue = [...entryPaths];
    const result = new Map();

    while (queue.length > 0) {
        const currentPath = queue.shift();
        if (
            !currentPath ||
            visited.has(currentPath) ||
            !fs.existsSync(currentPath)
        ) {
            continue;
        }

        visited.add(currentPath);
        for (const dependencyPath of parseOtoolDependencies(currentPath)) {
            if (isSystemDependency(dependencyPath)) {
                continue;
            }

            const resolvedPath = resolveDependencyPath(
                dependencyPath,
                currentPath
            );
            if (!resolvedPath || !fs.existsSync(resolvedPath)) {
                continue;
            }

            if (!result.has(path.basename(resolvedPath))) {
                result.set(path.basename(resolvedPath), resolvedPath);
                queue.push(resolvedPath);
            }
        }
    }

    return [...result.values()];
}

function findLibMpv(runtimeLibDir) {
    const candidates = ['libmpv.2.dylib', 'libmpv.dylib'];
    for (const candidate of candidates) {
        const candidatePath = path.join(runtimeLibDir, candidate);
        if (fs.existsSync(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
}

function patchDylibIds(libDir) {
    for (const dylibPath of listRuntimeFiles(libDir)) {
        if (!readInstallNameId(dylibPath)) {
            continue;
        }

        run('install_name_tool', [
            '-id',
            `@loader_path/${path.basename(dylibPath)}`,
            dylibPath,
        ]);
    }
}

function patchBinaryDependencies(
    binaryPath,
    dependencyBaseDir,
    replacementPrefix
) {
    const availableRuntimeFiles = new Set(
        listRuntimeFiles(dependencyBaseDir).map((runtimePath) =>
            path.basename(runtimePath)
        )
    );

    for (const dependencyPath of parseOtoolDependencies(binaryPath)) {
        const dependencyName = path.basename(dependencyPath);
        if (!availableRuntimeFiles.has(dependencyName)) {
            continue;
        }

        const replacementPath = `${replacementPrefix}/${dependencyName}`;
        if (dependencyPath === replacementPath) {
            continue;
        }

        run('install_name_tool', [
            '-change',
            dependencyPath,
            replacementPath,
            binaryPath,
        ]);
    }
}

function adHocSignBinary(binaryPath) {
    if (process.platform !== 'darwin' || !commandExists('codesign')) {
        return;
    }

    run('codesign', ['--force', '--sign', '-', '--timestamp=none', binaryPath]);
}

function adHocSignBinaries(binaryPaths) {
    for (const binaryPath of binaryPaths) {
        adHocSignBinary(binaryPath);
    }
}

function copyRuntimeToNativeBuild({
    runtimeLibDir,
    outputLibDir,
    runtimeOrigin,
    runtimeManifest,
}) {
    const libMpvPath = findLibMpv(runtimeLibDir);
    if (!libMpvPath) {
        throw new Error(`Unable to find libmpv in ${runtimeLibDir}.`);
    }

    removeDir(outputLibDir);
    ensureDir(outputLibDir);

    const runtimeFilesByName = new Map([
        [path.basename(libMpvPath), libMpvPath],
    ]);
    for (const dylibPath of collectExternalDylibs([libMpvPath])) {
        runtimeFilesByName.set(path.basename(dylibPath), dylibPath);
    }
    if (runtimeOrigin === 'vendored-lgpl') {
        for (const runtimePath of listRuntimeFiles(runtimeLibDir)) {
            runtimeFilesByName.set(path.basename(runtimePath), runtimePath);
        }
    }

    const dylibs = [...runtimeFilesByName.values()];
    for (const dylibPath of dylibs) {
        copyFile(dylibPath, path.join(outputLibDir, path.basename(dylibPath)));
    }

    if (!fs.existsSync(path.join(outputLibDir, 'libmpv.2.dylib'))) {
        const copiedLibMpvPath = path.join(
            outputLibDir,
            path.basename(libMpvPath)
        );
        if (path.basename(copiedLibMpvPath) !== 'libmpv.2.dylib') {
            copyFile(
                copiedLibMpvPath,
                path.join(outputLibDir, 'libmpv.2.dylib')
            );
        }
    }

    patchDylibIds(outputLibDir);
    for (const runtimePath of listRuntimeFiles(outputLibDir)) {
        patchBinaryDependencies(runtimePath, outputLibDir, '@loader_path');
    }
    adHocSignBinaries(listRuntimeFiles(outputLibDir));

    const manifest = {
        origin: runtimeOrigin,
        generatedAt: new Date().toISOString(),
        libDir: 'lib',
        runtimeFiles: listRuntimeFiles(outputLibDir).map((runtimePath) =>
            path.basename(runtimePath)
        ),
        dylibs: listDylibs(outputLibDir).map((dylibPath) =>
            path.basename(dylibPath)
        ),
        ...runtimeManifest,
    };

    fs.writeFileSync(
        path.join(path.dirname(outputLibDir), 'embedded-mpv-runtime.json'),
        `${JSON.stringify(manifest, null, 2)}\n`
    );

    return manifest;
}

function patchAddonForBundledRuntime(addonPath, outputLibDir) {
    if (!fs.existsSync(addonPath)) {
        throw new Error(`Missing embedded MPV native addon: ${addonPath}`);
    }

    patchBinaryDependencies(addonPath, outputLibDir, '@loader_path/lib');
    adHocSignBinary(addonPath);
}

function validateNoForbiddenRuntimeLinks(binaryPaths) {
    const errors = [];

    for (const binaryPath of binaryPaths) {
        if (!fs.existsSync(binaryPath)) {
            errors.push(`Missing binary: ${binaryPath}`);
            continue;
        }

        for (const dependencyPath of parseOtoolDependencies(binaryPath)) {
            if (isForbiddenDependency(dependencyPath)) {
                errors.push(
                    `${binaryPath} links to forbidden runtime path: ${dependencyPath}`
                );
            }

            if (dependencyPath.startsWith('@loader_path/')) {
                const resolvedPath = path.resolve(
                    path.dirname(binaryPath),
                    dependencyPath.replace('@loader_path/', '')
                );
                if (!fs.existsSync(resolvedPath)) {
                    errors.push(
                        `${binaryPath} links to missing bundled dependency: ${dependencyPath}`
                    );
                }
            }

            if (
                !isSystemDependency(dependencyPath) &&
                !dependencyPath.startsWith('@loader_path/')
            ) {
                errors.push(
                    `${binaryPath} links to non-bundled runtime path: ${dependencyPath}`
                );
            }
        }
    }

    return errors;
}

function getPackagedRuntimeCandidates(libDir, platform, nativeDir) {
    switch (platform) {
        case 'darwin':
            return [
                path.join(libDir, 'libmpv.2.dylib'),
                path.join(libDir, 'libmpv.dylib'),
            ];
        case 'win32':
            return [
                nativeDir ? path.join(nativeDir, 'mpv-2.dll') : null,
                nativeDir ? path.join(nativeDir, 'mpv.dll') : null,
                path.join(libDir, 'mpv-2.dll'),
                path.join(libDir, 'mpv.dll'),
            ].filter(Boolean);
        case 'linux':
            return [];
        default:
            return [];
    }
}

function normalizeEmbeddedMpvPlatform(value) {
    if (value === 'macos') {
        return 'darwin';
    }
    if (value === 'windows') {
        return 'win32';
    }
    return value ?? process.platform;
}

function validatePackagedEmbeddedMpv(resourceDir, options = {}) {
    const platform = normalizeEmbeddedMpvPlatform(options.platform);
    const unpackedNativeDir = path.join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    const addonPath = path.join(unpackedNativeDir, 'embedded_mpv.node');
    const libDir = path.join(unpackedNativeDir, 'lib');
    const manifestPath = path.join(
        unpackedNativeDir,
        'embedded-mpv-runtime.json'
    );
    const errors = [];

    if (!fs.existsSync(addonPath)) {
        if (options.required) {
            errors.push(`Missing embedded MPV native addon: ${addonPath}`);
        }
        return errors;
    }

    if (!fs.existsSync(manifestPath)) {
        errors.push(`Missing embedded MPV runtime manifest: ${manifestPath}`);
    } else {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const expectedOrigin =
            platform === 'linux' ? 'external-mpv-process' : 'vendored-lgpl';
        if (manifest.origin !== expectedOrigin) {
            errors.push(
                `Embedded MPV packaged runtime must be ${expectedOrigin}, received: ${manifest.origin}`
            );
        }
    }

    if (platform === 'linux') {
        const bundledLinuxRuntime = [
            path.join(libDir, 'libmpv.so.2'),
            path.join(libDir, 'libmpv.so.1'),
            path.join(libDir, 'libmpv.so'),
        ].filter((candidate) => fs.existsSync(candidate));

        if (bundledLinuxRuntime.length > 0) {
            errors.push(
                [
                    'Linux embedded MPV must use the external mpv process backend and must not bundle libmpv.',
                    'Remove:',
                    ...bundledLinuxRuntime.map((candidate) => `- ${candidate}`),
                ].join('\n')
            );
        }
    }

    const runtimeCandidates = getPackagedRuntimeCandidates(
        libDir,
        platform,
        unpackedNativeDir
    );
    if (
        runtimeCandidates.length > 0 &&
        !runtimeCandidates.some((candidate) => fs.existsSync(candidate))
    ) {
        errors.push(
            [
                `Missing bundled embedded MPV runtime for ${platform} in ${libDir}.`,
                'Expected one of:',
                ...runtimeCandidates.map((candidate) => `- ${candidate}`),
            ].join('\n')
        );
    }

    if (platform === 'darwin') {
        if (process.platform !== 'darwin') {
            errors.push(
                'macOS embedded MPV link validation must run on a macOS host.'
            );
        } else if (!commandExists('otool')) {
            errors.push(
                'otool is required to validate embedded MPV macOS packaging.'
            );
        } else {
            const binaries = [addonPath, ...listRuntimeFiles(libDir)];
            errors.push(...validateNoForbiddenRuntimeLinks(binaries));
        }
    }

    return errors;
}

module.exports = {
    collectExternalDylibs,
    commandExists,
    copyRuntimeToNativeBuild,
    findLibMpv,
    listRuntimeFiles,
    listDylibs,
    parseOtoolDependencies,
    parseOtoolRpaths,
    patchAddonForBundledRuntime,
    validateNoForbiddenRuntimeLinks,
    getPackagedRuntimeCandidates,
    validatePackagedEmbeddedMpv,
};
