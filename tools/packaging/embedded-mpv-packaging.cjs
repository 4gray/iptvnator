const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isDeepStrictEqual } = require('node:util');
const {
    EXTERNAL_SYSTEM_LIBRARIES,
    GLIBC_TOOLCHAIN_ALLOWLIST,
    parseReadelfDynamic,
    validateRuntimeDependencyClosure,
} = require('../embedded-mpv/build-linux-runtime.cjs');
const {
    validateLinuxRuntimeManifest,
} = require('../embedded-mpv/linux-runtime-manifest.cjs');
const {
    validateLinuxSourceArchiveBinding,
} = require('../embedded-mpv/linux-source-archive-contract.cjs');
const {
    NOTICE_MANIFEST,
    THIRD_PARTY_NOTICES,
    validateLinuxRuntimeNotices,
} = require('../embedded-mpv/generate-linux-runtime-notices.cjs');
const {
    LINUX_SYSTEM_PACKAGE_DEPENDENCIES,
    resolveLinuxFrameCopyProfile,
    validateLinuxProfileTargets,
} = require('./linux-frame-copy-profile.cjs');

const forbiddenRuntimePathPrefixes = ['/opt/homebrew/', '/usr/local/'];
const systemRuntimePathPrefixes = ['/System/Library/', '/usr/lib/'];
const windowsMpvRuntimeNames = [
    'mpv-2.dll',
    'libmpv-2.dll',
    'mpv.dll',
    'libmpv.dll',
];
const linuxFrameCopyArtifacts = Object.freeze({
    addon: Object.freeze({
        name: 'embedded_mpv.node',
        regularFile: true,
        readable: true,
    }),
    frameReader: Object.freeze({
        name: 'embedded_mpv_frame_reader.node',
        regularFile: true,
        readable: true,
    }),
    helper: Object.freeze({
        name: 'iptvnator_mpv_helper',
        regularFile: true,
        readable: true,
        executable: true,
    }),
});
const linuxFrameCopyProcessIsolation = Object.freeze({
    addonLoadsLibmpv: false,
    readerLoadsLibmpv: false,
    electronLoadsLibmpv: false,
    helperLinksLibmpv: true,
    helperRunpath: Object.freeze(['$ORIGIN/lib']),
});
const linuxNativeViewFallback = 'process-isolated mpv --wid';
const versionedLinuxLibmpvPattern = /^libmpv\.so\.\d+(?:\.\d+)*$/;
const anyLinuxLibmpvPattern = /^libmpv\.so(?:\.|$)/;
const linuxRuntimeLegalPaths = Object.freeze([
    NOTICE_MANIFEST,
    THIRD_PARTY_NOTICES,
    'licenses',
]);

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

function assertPeRange(image, offset, size, label) {
    if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(size) ||
        offset < 0 ||
        size < 0 ||
        offset + size > image.length
    ) {
        throw new Error(`Invalid PE image: ${label} is out of range.`);
    }
}

function readPeImportedDllNames(binaryPath) {
    const image = fs.readFileSync(binaryPath);
    assertPeRange(image, 0, 0x40, 'DOS header');
    if (image.toString('ascii', 0, 2) !== 'MZ') {
        throw new Error('Invalid PE image: missing DOS signature.');
    }

    const peOffset = image.readUInt32LE(0x3c);
    assertPeRange(image, peOffset, 24, 'PE header');
    if (image.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
        throw new Error('Invalid PE image: missing PE signature.');
    }

    const sectionCount = image.readUInt16LE(peOffset + 6);
    const optionalHeaderSize = image.readUInt16LE(peOffset + 20);
    const optionalHeaderOffset = peOffset + 24;
    assertPeRange(
        image,
        optionalHeaderOffset,
        optionalHeaderSize,
        'optional header'
    );

    const optionalMagic = image.readUInt16LE(optionalHeaderOffset);
    const dataDirectoryOffset =
        optionalMagic === 0x20b
            ? optionalHeaderOffset + 112
            : optionalMagic === 0x10b
              ? optionalHeaderOffset + 96
              : null;
    const directoryCountOffset =
        optionalMagic === 0x20b
            ? optionalHeaderOffset + 108
            : optionalMagic === 0x10b
              ? optionalHeaderOffset + 92
              : null;
    if (dataDirectoryOffset === null || directoryCountOffset === null) {
        throw new Error(
            `Invalid PE image: unsupported optional-header magic 0x${optionalMagic.toString(16)}.`
        );
    }
    const optionalHeaderEnd = optionalHeaderOffset + optionalHeaderSize;
    if (
        directoryCountOffset + 4 > optionalHeaderEnd ||
        dataDirectoryOffset + 16 > optionalHeaderEnd
    ) {
        throw new Error(
            'Invalid PE image: data directories exceed the optional header.'
        );
    }
    assertPeRange(image, directoryCountOffset, 4, 'data-directory count');
    if (image.readUInt32LE(directoryCountOffset) < 2) {
        return [];
    }
    assertPeRange(image, dataDirectoryOffset + 8, 8, 'import directory');

    const importRva = image.readUInt32LE(dataDirectoryOffset + 8);
    const importSize = image.readUInt32LE(dataDirectoryOffset + 12);
    if (importRva === 0 && importSize === 0) {
        return [];
    }
    if (importRva === 0 || importSize < 20) {
        throw new Error('Invalid PE image: malformed import directory.');
    }

    const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
    assertPeRange(
        image,
        sectionTableOffset,
        sectionCount * 40,
        'section table'
    );
    const sections = Array.from({ length: sectionCount }, (_, index) => {
        const offset = sectionTableOffset + index * 40;
        return {
            virtualSize: image.readUInt32LE(offset + 8),
            virtualAddress: image.readUInt32LE(offset + 12),
            rawSize: image.readUInt32LE(offset + 16),
            rawOffset: image.readUInt32LE(offset + 20),
        };
    });

    const rvaToLocation = (rva, label) => {
        const section = sections.find(
            (candidate) =>
                rva >= candidate.virtualAddress &&
                rva <
                    candidate.virtualAddress +
                        Math.max(candidate.virtualSize, candidate.rawSize)
        );
        if (!section) {
            throw new Error(
                `Invalid PE image: ${label} RVA 0x${rva.toString(16)} is not mapped.`
            );
        }

        const sectionOffset = rva - section.virtualAddress;
        if (sectionOffset >= section.rawSize) {
            throw new Error(
                `Invalid PE image: ${label} is outside section file data.`
            );
        }
        const offset = section.rawOffset + sectionOffset;
        assertPeRange(image, offset, 1, label);
        return {
            offset,
            sectionEnd: section.rawOffset + section.rawSize,
        };
    };

    const importedDllNames = [];
    const descriptorCount = Math.floor(importSize / 20);
    let foundTerminator = false;
    for (let index = 0; index < descriptorCount; index += 1) {
        const descriptorLocation = rvaToLocation(
            importRva + index * 20,
            'import descriptor'
        );
        const descriptorOffset = descriptorLocation.offset;
        if (descriptorOffset + 20 > descriptorLocation.sectionEnd) {
            throw new Error(
                'Invalid PE image: import descriptor crosses section file data.'
            );
        }
        assertPeRange(image, descriptorOffset, 20, 'import descriptor');
        const descriptor = image.subarray(
            descriptorOffset,
            descriptorOffset + 20
        );
        if (descriptor.every((value) => value === 0)) {
            foundTerminator = true;
            break;
        }

        const nameRva = image.readUInt32LE(descriptorOffset + 12);
        const nameLocation = rvaToLocation(nameRva, 'imported DLL name');
        const nameOffset = nameLocation.offset;
        const nameEnd = image.indexOf(0, nameOffset);
        if (nameEnd < 0 || nameEnd >= nameLocation.sectionEnd) {
            throw new Error(
                'Invalid PE image: imported DLL name is not terminated.'
            );
        }
        const name = image.toString('ascii', nameOffset, nameEnd);
        if (!name) {
            throw new Error('Invalid PE image: imported DLL name is empty.');
        }
        importedDllNames.push(name);
    }

    if (!foundTerminator) {
        throw new Error(
            'Invalid PE image: import descriptor table has no terminator.'
        );
    }

    return [...new Set(importedDllNames)];
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
            return windowsMpvRuntimeNames.flatMap((name) =>
                [
                    nativeDir ? path.join(nativeDir, name) : null,
                    path.join(libDir, name),
                ].filter(Boolean)
            );
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

// electron-builder passes `arch` to afterPack as a builder-util Arch enum
// value; this table mirrors that enum's declaration order.
const ELECTRON_BUILDER_ARCH_NAMES = [
    'ia32',
    'x64',
    'armv7l',
    'arm64',
    'universal',
];

function resolveElectronBuilderArchName(arch) {
    if (typeof arch === 'string') {
        return ELECTRON_BUILDER_ARCH_NAMES.includes(arch) ? arch : null;
    }
    return ELECTRON_BUILDER_ARCH_NAMES[arch] ?? null;
}

function resolveConfiguredLinuxTargetNames(configuredTargets, targetArch) {
    if (!Array.isArray(configuredTargets)) {
        throw new TypeError('Electron Builder linux.target must be an array.');
    }
    const archName = resolveElectronBuilderArchName(targetArch);
    if (!archName) {
        throw new Error(
            `Unknown Electron Builder architecture: ${String(targetArch)}.`
        );
    }

    const targetNames = new Set();
    for (const target of configuredTargets) {
        const targetName =
            typeof target === 'string'
                ? target
                : target && typeof target === 'object'
                  ? target.target
                  : null;
        if (typeof targetName !== 'string' || targetName.trim() === '') {
            throw new Error(
                'Electron Builder Linux targets must have a non-empty target name.'
            );
        }

        if (target && typeof target === 'object' && target.arch !== undefined) {
            const configuredArches = Array.isArray(target.arch)
                ? target.arch
                : [target.arch];
            const configuredArchNames = configuredArches.map(
                (configuredArch) => {
                    const configuredArchName =
                        resolveElectronBuilderArchName(configuredArch);
                    if (!configuredArchName) {
                        throw new Error(
                            `Unknown Electron Builder architecture: ${String(
                                configuredArch
                            )}.`
                        );
                    }
                    return configuredArchName;
                }
            );
            if (!configuredArchNames.includes(archName)) {
                continue;
            }
        }
        targetNames.add(targetName.trim().toLowerCase());
    }

    if (targetNames.size === 0) {
        throw new Error(
            `Electron Builder has no Linux targets configured for ${archName}.`
        );
    }
    return [...targetNames].sort();
}

/**
 * Official Linux frame-copy support is x64-only. electron-builder also
 * produces arm64/armv7l packages, which must always carry only the
 * unavailable marker and native-view fallback.
 */
function isForeignLinuxEmbeddedMpvArch(platform, targetArch) {
    if (normalizeEmbeddedMpvPlatform(platform) !== 'linux') {
        return false;
    }
    const archName = resolveElectronBuilderArchName(targetArch);
    return Boolean(archName) && archName !== 'x64';
}

// Maps electron-builder Linux output directory names (`linux-unpacked`,
// `linux-arm64-unpacked`, ...) to the package architecture. `null` when the
// name is not a Linux unpacked directory.
function linuxUnpackedDirArch(unpackedDirName) {
    const match = /^linux-(?:([a-z0-9_]+)-)?unpacked$/.exec(unpackedDirName);
    if (!match) {
        return null;
    }
    return match[1] ?? 'x64';
}

function pathExistsByLstat(filePath) {
    try {
        fs.lstatSync(filePath);
        return true;
    } catch {
        return false;
    }
}

function inspectRegularReadableFile(
    filePath,
    label,
    errors,
    expectedMode = null
) {
    let stat;
    try {
        stat = fs.lstatSync(filePath);
    } catch {
        errors.push(`Missing ${label}: ${filePath}`);
        return null;
    }

    if (!stat.isFile() || stat.isSymbolicLink()) {
        errors.push(`${label} must be a regular file: ${filePath}`);
        return null;
    }
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
        errors.push(`${label} must be readable: ${filePath}`);
    }

    if (expectedMode !== null && (stat.mode & 0o7777) !== expectedMode) {
        errors.push(
            `${label} must have mode ${expectedMode
                .toString(8)
                .padStart(4, '0')}: ${filePath}`
        );
    }
    return stat;
}

function readPackagedJson(filePath, label, errors) {
    let contents;
    try {
        contents = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        errors.push(
            `Unable to read ${label} at ${filePath}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return null;
    }

    try {
        return JSON.parse(contents);
    } catch (error) {
        errors.push(
            `Invalid JSON in ${label} at ${filePath}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return null;
    }
}

function validateForeignLinuxNativeDir(nativeDir) {
    const errors = [];
    const markerName = 'embedded-mpv-unavailable.txt';
    const markerPath = path.join(nativeDir, markerName);
    let nativeStat;
    try {
        nativeStat = fs.lstatSync(nativeDir);
    } catch {
        return [
            `Missing embedded MPV unavailable marker for foreign-architecture package: ${markerPath}`,
        ];
    }
    if (!nativeStat.isDirectory() || nativeStat.isSymbolicLink()) {
        return [
            `Foreign-architecture embedded MPV native path must be a regular directory: ${nativeDir}`,
        ];
    }

    const entries = fs.readdirSync(nativeDir).sort();
    const unexpectedEntries = entries.filter((name) => name !== markerName);
    if (unexpectedEntries.length > 0) {
        errors.push(
            [
                'Embedded MPV artifacts must not ship in foreign-architecture Linux packages; only the unavailable marker is allowed.',
                ...unexpectedEntries.map(
                    (name) => `- ${path.join(nativeDir, name)}`
                ),
            ].join('\n')
        );
    }
    if (!entries.includes(markerName)) {
        errors.push(
            `Missing embedded MPV unavailable marker for foreign-architecture package: ${markerPath}`
        );
    } else {
        inspectRegularReadableFile(
            markerPath,
            'embedded MPV unavailable marker',
            errors
        );
    }
    return errors;
}

function validateNativeViewOnlyLinuxPackage(
    nativeDir,
    addonPath,
    manifestPath,
    errors
) {
    for (const legalPath of linuxRuntimeLegalPaths) {
        const packagedLegalPath = path.join(nativeDir, legalPath);
        if (pathExistsByLstat(packagedLegalPath)) {
            errors.push(
                `Linux native-view-only packages must not ship bundled runtime legal files: ${packagedLegalPath}`
            );
        }
    }
    for (const artifactName of [
        'iptvnator_mpv_helper',
        'iptvnator_mpv_helper.exe',
        'embedded_mpv_frame_reader.node',
    ]) {
        const artifactPath = path.join(nativeDir, artifactName);
        if (pathExistsByLstat(artifactPath)) {
            errors.push(
                `Linux native-view-only packages must not ship frame-copy helpers or readers: ${artifactPath}`
            );
        }
    }

    const markerPath = path.join(nativeDir, 'embedded-mpv-unavailable.txt');
    if (pathExistsByLstat(markerPath)) {
        errors.push(
            `Same-architecture Linux packages must not retain the unavailable marker: ${markerPath}`
        );
    }

    const libDir = path.join(nativeDir, 'lib');
    if (pathExistsByLstat(libDir)) {
        errors.push(
            `Linux native-view-only packages must not bundle libmpv or retain a private runtime directory: ${libDir}`
        );
    }

    inspectRegularReadableFile(addonPath, 'embedded MPV native addon', errors);
    if (
        !inspectRegularReadableFile(
            manifestPath,
            'embedded MPV runtime manifest',
            errors
        )
    ) {
        return;
    }
    const manifest = readPackagedJson(
        manifestPath,
        'embedded MPV runtime manifest',
        errors
    );
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        if (manifest !== null) {
            errors.push('Embedded MPV runtime manifest must be an object.');
        }
        return;
    }

    const expectedFields = {
        schemaVersion: 1,
        origin: 'external-mpv-process',
        platform: 'linux',
        arch: 'x64',
        runtimeMode: 'native-view-only',
        frameCopyAvailable: false,
        artifacts: { addon: 'embedded_mpv.node' },
        nativeViewFallback: linuxNativeViewFallback,
    };
    for (const [field, expected] of Object.entries(expectedFields)) {
        if (!isDeepStrictEqual(manifest[field], expected)) {
            errors.push(
                `Linux native-view-only manifest ${field} must equal ${JSON.stringify(
                    expected
                )}; received ${JSON.stringify(manifest[field])}.`
            );
        }
    }
    if (Object.hasOwn(manifest, 'profile')) {
        errors.push(
            'Linux native-view-only manifest must not include a frame-copy profile.'
        );
    }
}

function normalizeLinuxTargetNames(targetNames, errors) {
    if (!Array.isArray(targetNames) || targetNames.length === 0) {
        errors.push(
            'Linux frame-copy package validation requires at least one target name.'
        );
        return [];
    }
    const normalized = [];
    for (const targetName of targetNames) {
        const name = String(targetName ?? '')
            .trim()
            .toLowerCase();
        if (!name) {
            errors.push(
                'Linux frame-copy target names must be non-empty strings.'
            );
            continue;
        }
        if (normalized.includes(name)) {
            errors.push(`Linux frame-copy target "${name}" is duplicated.`);
            continue;
        }
        normalized.push(name);
    }
    return normalized.sort();
}

function validatePackagedManifestContract(
    manifest,
    profile,
    targetNames,
    errors
) {
    const expectedFields = {
        schemaVersion: 1,
        origin: profile.manifestOrigin,
        platform: 'linux',
        arch: 'x64',
        profile: profile.name,
        runtimeMode: profile.runtimeMode,
        targets: targetNames,
        artifacts: linuxFrameCopyArtifacts,
        processIsolation: linuxFrameCopyProcessIsolation,
        nativeViewFallback: linuxNativeViewFallback,
    };
    for (const [field, expected] of Object.entries(expectedFields)) {
        if (!isDeepStrictEqual(manifest[field], expected)) {
            errors.push(
                `Linux frame-copy manifest ${field} for profile "${profile.name}" must equal ${JSON.stringify(
                    expected
                )}; received ${JSON.stringify(manifest[field])}.`
            );
        }
    }

    if (
        typeof manifest.generatedAt !== 'string' ||
        manifest.generatedAt.trim() === '' ||
        Number.isNaN(Date.parse(manifest.generatedAt))
    ) {
        errors.push(
            'Linux frame-copy manifest generatedAt must be a valid timestamp.'
        );
    }
    if (
        typeof manifest.libmpvSoname !== 'string' ||
        !versionedLinuxLibmpvPattern.test(manifest.libmpvSoname)
    ) {
        errors.push(
            'Linux frame-copy manifest libmpvSoname must be a versioned libmpv SONAME.'
        );
    }
}

function validateSystemLinuxRuntime(nativeDir, manifest, errors) {
    for (const legalPath of linuxRuntimeLegalPaths) {
        const packagedLegalPath = path.join(nativeDir, legalPath);
        if (pathExistsByLstat(packagedLegalPath)) {
            errors.push(
                `Linux system frame-copy packages must not ship bundled runtime legal files: ${packagedLegalPath}`
            );
        }
    }
    if (
        !isDeepStrictEqual(
            manifest.packageDependencies,
            LINUX_SYSTEM_PACKAGE_DEPENDENCIES
        )
    ) {
        errors.push(
            `Linux system frame-copy manifest packageDependencies must equal ${JSON.stringify(
                LINUX_SYSTEM_PACKAGE_DEPENDENCIES
            )}.`
        );
    }
    if (!isDeepStrictEqual(manifest.runtimeFiles, [])) {
        errors.push(
            'Linux system frame-copy manifest runtimeFiles must be empty.'
        );
    }
    if (manifest.runtimeTotalBytes !== 0) {
        errors.push(
            'Linux system frame-copy manifest runtimeTotalBytes must equal 0.'
        );
    }
    for (const forbiddenField of [
        'runtimeDependencyClosure',
        'externalSystemLibraries',
        'sourceArchive',
        'sourceRuntime',
    ]) {
        if (Object.hasOwn(manifest, forbiddenField)) {
            errors.push(
                `Linux system frame-copy manifest must not include ${forbiddenField}.`
            );
        }
    }

    const libDir = path.join(nativeDir, 'lib');
    if (pathExistsByLstat(libDir)) {
        errors.push(
            `Linux system frame-copy packages must not retain a private runtime directory: ${libDir}`
        );
    }
}

function sha256File(filePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
}

function validateBundledLinuxRuntime(nativeDir, manifest, errors) {
    if (!isDeepStrictEqual(manifest.packageDependencies, {})) {
        errors.push(
            'Linux bundled frame-copy manifest packageDependencies must be empty.'
        );
    }

    const sourceRuntimeErrors = validateLinuxRuntimeManifest(
        manifest.sourceRuntime
    );
    errors.push(
        ...sourceRuntimeErrors.map(
            (error) => `Invalid packaged Linux source runtime: ${error}`
        )
    );
    errors.push(
        ...validateLinuxSourceArchiveBinding(manifest.sourceArchive).map(
            (error) => `Invalid packaged Linux source archive binding: ${error}`
        )
    );
    errors.push(
        ...validateLinuxRuntimeNotices(nativeDir, manifest.sourceRuntime, {
            allowUnrelatedFiles: true,
        }).map((error) => `Invalid packaged Linux runtime notices: ${error}`)
    );
    if (
        !isDeepStrictEqual(
            manifest.runtimeFiles,
            manifest.sourceRuntime?.runtimeFiles
        )
    ) {
        errors.push(
            'Linux bundled frame-copy manifest runtimeFiles must exactly match sourceRuntime.runtimeFiles.'
        );
    }
    if (
        !isDeepStrictEqual(
            manifest.runtimeDependencyClosure,
            manifest.sourceRuntime?.runtimeDependencyClosure
        )
    ) {
        errors.push(
            'Linux bundled frame-copy manifest runtimeDependencyClosure must exactly match sourceRuntime.runtimeDependencyClosure.'
        );
    }
    if (
        !isDeepStrictEqual(
            manifest.externalSystemLibraries,
            manifest.sourceRuntime?.externalSystemLibraries
        )
    ) {
        errors.push(
            'Linux bundled frame-copy manifest externalSystemLibraries must exactly match sourceRuntime.externalSystemLibraries.'
        );
    }

    if (!Array.isArray(manifest.runtimeFiles)) {
        errors.push(
            'Linux bundled frame-copy manifest runtimeFiles must be an array.'
        );
        return;
    }
    const expectedTotal = manifest.runtimeFiles.reduce(
        (total, runtimeFile) =>
            total +
            (runtimeFile &&
            Number.isSafeInteger(runtimeFile.size) &&
            runtimeFile.size > 0
                ? runtimeFile.size
                : 0),
        0
    );
    if (manifest.runtimeTotalBytes !== expectedTotal) {
        errors.push(
            `Linux bundled frame-copy manifest runtimeTotalBytes must equal ${expectedTotal}.`
        );
    }

    const libDir = path.join(nativeDir, 'lib');
    let libStat;
    try {
        libStat = fs.lstatSync(libDir);
    } catch {
        errors.push(`Missing bundled Linux runtime directory: ${libDir}`);
        return;
    }
    if (!libStat.isDirectory() || libStat.isSymbolicLink()) {
        errors.push(
            `Bundled Linux runtime path must be a regular directory: ${libDir}`
        );
        return;
    }

    const declaredNames = new Set();
    for (const runtimeFile of manifest.runtimeFiles) {
        if (
            !runtimeFile ||
            typeof runtimeFile.name !== 'string' ||
            path.basename(runtimeFile.name) !== runtimeFile.name ||
            runtimeFile.name === '.' ||
            runtimeFile.name === '..'
        ) {
            errors.push(
                `Bundled Linux runtime manifest contains an unsafe file name: ${JSON.stringify(
                    runtimeFile?.name
                )}.`
            );
            continue;
        }
        if (declaredNames.has(runtimeFile.name)) {
            errors.push(
                `Bundled Linux runtime manifest contains duplicate file ${runtimeFile.name}.`
            );
            continue;
        }
        declaredNames.add(runtimeFile.name);
    }

    let packagedEntries;
    try {
        packagedEntries = fs.readdirSync(libDir).sort();
    } catch (error) {
        errors.push(
            `Unable to enumerate bundled Linux runtime at ${libDir}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return;
    }
    for (const entryName of packagedEntries) {
        if (!declaredNames.has(entryName)) {
            errors.push(
                `Found undeclared bundled Linux runtime artifact: ${path.join(
                    libDir,
                    entryName
                )}`
            );
        }
    }

    for (const runtimeFile of manifest.runtimeFiles) {
        if (!runtimeFile || !declaredNames.has(runtimeFile.name)) {
            continue;
        }
        const runtimePath = path.join(libDir, runtimeFile.name);
        const stat = inspectRegularReadableFile(
            runtimePath,
            `bundled Linux runtime file ${runtimeFile.name}`,
            errors
        );
        if (!stat) {
            continue;
        }
        if (stat.size !== runtimeFile.size) {
            errors.push(
                `Bundled Linux runtime size mismatch for ${runtimeFile.name}: expected ${runtimeFile.size}, received ${stat.size}.`
            );
        }
        let actualSha256;
        try {
            actualSha256 = sha256File(runtimePath);
        } catch (error) {
            errors.push(
                `Unable to hash bundled Linux runtime file ${runtimePath}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            continue;
        }
        if (actualSha256 !== runtimeFile.sha256) {
            errors.push(
                `Bundled Linux runtime SHA-256 mismatch for ${runtimeFile.name}: expected ${runtimeFile.sha256}, received ${actualSha256}.`
            );
        }
    }
}

function normalizeElfInspection(value, binaryPath) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(
            `ELF inspection for ${binaryPath} must return an object.`
        );
    }
    const result = {
        soname: value.soname ?? null,
    };
    if (
        result.soname !== null &&
        (typeof result.soname !== 'string' ||
            path.basename(result.soname) !== result.soname)
    ) {
        throw new Error(
            `ELF inspection for ${binaryPath} must return a safe SONAME or null.`
        );
    }
    for (const field of ['needed', 'rpath', 'runpath']) {
        if (
            !Array.isArray(value[field]) ||
            value[field].some((entry) => typeof entry !== 'string')
        ) {
            throw new Error(
                `ELF inspection for ${binaryPath} must return string array ${field}.`
            );
        }
        result[field] = [...new Set(value[field])].sort();
    }
    return result;
}

function dependencyFileName(dependencyName) {
    return dependencyName.replaceAll('\\', '/').split('/').at(-1) ?? '';
}

function listElectronShippedLinuxLibraries(resourceDir, options = {}) {
    const appDir = path.dirname(resourceDir);
    const normalizedResourceDir = path.resolve(resourceDir);
    const excludedSnapLibraryRoots =
        options.artifactFormat === 'snap'
            ? new Set(
                  [
                      path.join(appDir, 'lib'),
                      path.join(appDir, 'usr', 'lib'),
                  ].map((directoryPath) => path.resolve(directoryPath))
              )
            : new Set();
    const libraries = [];

    function visit(directoryPath) {
        for (const entry of fs.readdirSync(directoryPath, {
            withFileTypes: true,
        })) {
            const entryPath = path.join(directoryPath, entry.name);
            if (path.resolve(entryPath) === normalizedResourceDir) {
                continue;
            }
            if (entry.isDirectory()) {
                if (excludedSnapLibraryRoots.has(path.resolve(entryPath))) {
                    continue;
                }
                visit(entryPath);
                continue;
            }
            if (
                (entry.isFile() || entry.isSymbolicLink()) &&
                /\.so(?:\.\d+)*$/.test(entry.name)
            ) {
                libraries.push(entryPath);
            }
        }
    }

    // afterPack and unpacked-layout checks see the pristine Electron tree, so
    // recurse to catch future nested Electron libraries. An extracted Snap
    // overlays package-manager lib/ and usr/lib/ trees onto that same root;
    // exclude exactly those target-provided roots while scanning everything
    // else recursively.
    visit(appDir);
    return libraries.sort();
}

function inspectLinuxElfIsolation(
    resourceDir,
    nativeDir,
    manifest,
    options,
    errors
) {
    const hostPlatform = options.hostPlatform ?? process.platform;
    let inspectElf = options.elfInspector;
    if (!inspectElf) {
        if (hostPlatform !== 'linux') {
            return;
        }
        if (!commandExists('readelf')) {
            errors.push(
                'readelf is required to validate Linux embedded MPV packaging.'
            );
            return;
        }
        inspectElf = (binaryPath) =>
            parseReadelfDynamic(run('readelf', ['-d', binaryPath]));
    }
    if (typeof inspectElf !== 'function') {
        errors.push('Linux ELF inspector must be a function.');
        return;
    }

    const executableName = options.executableName ?? 'iptvnator';
    const inspectedPaths = {
        electron: path.join(path.dirname(resourceDir), `${executableName}.bin`),
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
    const inspections = {};
    for (const [label, binaryPath] of Object.entries(inspectedPaths)) {
        if (
            !inspectRegularReadableFile(
                binaryPath,
                `Linux ${label} ELF binary`,
                errors
            )
        ) {
            continue;
        }
        try {
            inspections[label] = normalizeElfInspection(
                inspectElf(binaryPath),
                binaryPath
            );
        } catch (error) {
            errors.push(
                `Unable to inspect Linux ${label} ELF binary at ${binaryPath}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    for (const label of Object.keys(inspections).filter(
        (name) =>
            name === 'electron' ||
            name === 'addon' ||
            name === 'reader' ||
            name.startsWith('electronLibrary:')
    )) {
        const dynamic = inspections[label];
        if (!dynamic) {
            continue;
        }
        const displayLabel = label.startsWith('electronLibrary:')
            ? 'Electron library'
            : label;
        for (const dependencyName of dynamic.needed) {
            if (dependencyFileName(dependencyName) !== dependencyName) {
                errors.push(
                    `Linux ${displayLabel} DT_NEEDED entry must not contain a path: ${dependencyName} in ${inspectedPaths[label]}.`
                );
            }
        }
        const libmpvDependencies = dynamic.needed.filter((dependencyName) =>
            anyLinuxLibmpvPattern.test(dependencyFileName(dependencyName))
        );
        if (libmpvDependencies.length > 0) {
            errors.push(
                `Linux ${displayLabel} must not link libmpv; found ${libmpvDependencies.join(
                    ', '
                )} in ${inspectedPaths[label]}.`
            );
        }
    }

    const helper = inspections.helper;
    if (helper) {
        if (!helper.needed.includes(manifest.libmpvSoname)) {
            errors.push(
                `Linux frame-copy helper must directly need ${manifest.libmpvSoname}.`
            );
        }
        const unexpectedLibmpvDependencies = helper.needed.filter(
            (dependencyName) =>
                anyLinuxLibmpvPattern.test(
                    dependencyFileName(dependencyName)
                ) && dependencyName !== manifest.libmpvSoname
        );
        if (unexpectedLibmpvDependencies.length > 0) {
            errors.push(
                `Linux frame-copy helper must not need a different libmpv SONAME: ${unexpectedLibmpvDependencies.join(
                    ', '
                )}.`
            );
        }
        if (helper.rpath.length > 0) {
            errors.push(
                `Linux frame-copy helper must not contain RPATH; found ${helper.rpath.join(
                    ':'
                )}.`
            );
        }
        if (
            helper.runpath.length !== 1 ||
            helper.runpath[0] !== '$ORIGIN/lib'
        ) {
            errors.push(
                `Linux frame-copy helper RUNPATH must be exactly $ORIGIN/lib; received ${
                    helper.runpath.length > 0
                        ? helper.runpath.join(':')
                        : '<empty>'
                }.`
            );
        }

        const allowedHelperDependencies = new Set([
            manifest.libmpvSoname,
            ...GLIBC_TOOLCHAIN_ALLOWLIST,
            ...EXTERNAL_SYSTEM_LIBRARIES.map(({ name }) => name),
            ...(manifest.runtimeMode === 'bundled' &&
            Array.isArray(manifest.runtimeFiles)
                ? manifest.runtimeFiles.map(({ name }) => name)
                : []),
            ...(manifest.runtimeMode === 'bundled' &&
            Array.isArray(
                manifest.runtimeDependencyClosure?.externalDependencies
            )
                ? manifest.runtimeDependencyClosure.externalDependencies
                : []),
        ]);
        for (const dependencyName of helper.needed) {
            if (
                dependencyFileName(dependencyName) !== dependencyName ||
                !allowedHelperDependencies.has(dependencyName)
            ) {
                errors.push(
                    `Linux frame-copy helper dependency is not bundled or allowlisted: ${dependencyName}.`
                );
            }
        }
    }

    if (
        manifest.runtimeMode !== 'bundled' ||
        !Array.isArray(manifest.runtimeFiles)
    ) {
        return;
    }

    const runtimeFileNames = manifest.runtimeFiles
        .map((runtimeFile) => runtimeFile?.name)
        .filter((name) => typeof name === 'string');
    const runtimeNameSet = new Set(runtimeFileNames);
    const allowedExternalNames = new Set([
        ...GLIBC_TOOLCHAIN_ALLOWLIST,
        ...EXTERNAL_SYSTEM_LIBRARIES.map(({ name }) => name),
    ]);
    const closureEntries = [];
    let closureHasErrors = false;
    for (const runtimeFileName of runtimeFileNames) {
        const runtimePath = path.join(nativeDir, 'lib', runtimeFileName);
        let dynamic;
        try {
            dynamic = normalizeElfInspection(
                inspectElf(runtimePath),
                runtimePath
            );
        } catch (error) {
            closureHasErrors = true;
            errors.push(
                `Unable to inspect bundled Linux runtime ELF at ${runtimePath}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            continue;
        }
        closureEntries.push({
            name: runtimeFileName,
            soname: dynamic.soname,
            needed: dynamic.needed,
            rpath: dynamic.rpath,
            runpath: dynamic.runpath,
        });
        if (dynamic.rpath.length > 0) {
            closureHasErrors = true;
            errors.push(
                `${runtimeFileName} has forbidden RPATH ${dynamic.rpath.join(
                    ':'
                )}.`
            );
        }
        if (dynamic.runpath.length !== 1 || dynamic.runpath[0] !== '$ORIGIN') {
            closureHasErrors = true;
            errors.push(
                `${runtimeFileName} RUNPATH must be exactly $ORIGIN; got ${
                    dynamic.runpath.length > 0
                        ? dynamic.runpath.join(':')
                        : '<empty>'
                }.`
            );
        }
        for (const dependencyName of dynamic.needed) {
            if (
                !runtimeNameSet.has(dependencyName) &&
                !allowedExternalNames.has(dependencyName)
            ) {
                closureHasErrors = true;
                errors.push(
                    `Runtime dependency is not bundled or allowlisted: ${runtimeFileName} -> ${dependencyName}.`
                );
            }
        }
    }

    if (closureHasErrors) {
        return;
    }
    try {
        const actualClosure = validateRuntimeDependencyClosure({
            entries: closureEntries,
            runtimeFileNames,
            buildPrefix: '',
        });
        if (
            !isDeepStrictEqual(actualClosure, manifest.runtimeDependencyClosure)
        ) {
            errors.push(
                'Actual bundled Linux ELF dependency closure does not match the packaged manifest.'
            );
        }
    } catch (error) {
        errors.push(
            `Invalid bundled Linux ELF dependency closure: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

function validateLinuxPackagedEmbeddedMpv(resourceDir, options) {
    const nativeDir = path.join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    if (options.foreignArch) {
        return validateForeignLinuxNativeDir(nativeDir);
    }

    const errors = [];
    const addonPath = path.join(nativeDir, 'embedded_mpv.node');
    const manifestPath = path.join(nativeDir, 'embedded-mpv-runtime.json');
    if (!pathExistsByLstat(addonPath)) {
        if (options.required) {
            errors.push(`Missing embedded MPV native addon: ${addonPath}`);
        }
        if (pathExistsByLstat(nativeDir)) {
            for (const staleName of [
                'embedded_mpv_frame_reader.node',
                'iptvnator_mpv_helper',
                'iptvnator_mpv_helper.exe',
                'embedded-mpv-runtime.json',
                'embedded-mpv-unavailable.txt',
                'lib',
            ]) {
                const stalePath = path.join(nativeDir, staleName);
                if (pathExistsByLstat(stalePath)) {
                    errors.push(
                        `Embedded MPV addon is missing but stale packaged artifact remains: ${stalePath}`
                    );
                }
            }
        }
        return errors;
    }

    if (!options.profile) {
        if (options.required) {
            errors.push(
                'Linux frame-copy profile is required for a required same-architecture package.'
            );
        }
        validateNativeViewOnlyLinuxPackage(
            nativeDir,
            addonPath,
            manifestPath,
            errors
        );
        return errors;
    }

    let profile;
    try {
        profile = resolveLinuxFrameCopyProfile(options.profile);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return errors;
    }
    const targetNames = normalizeLinuxTargetNames(options.targetNames, errors);
    if (targetNames.length > 0) {
        try {
            errors.push(
                ...validateLinuxProfileTargets(profile.name, targetNames)
            );
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }

    const readerPath = path.join(
        nativeDir,
        linuxFrameCopyArtifacts.frameReader.name
    );
    const helperPath = path.join(
        nativeDir,
        linuxFrameCopyArtifacts.helper.name
    );
    inspectRegularReadableFile(addonPath, 'embedded MPV native addon', errors);
    inspectRegularReadableFile(
        readerPath,
        'embedded MPV frame reader',
        errors,
        0o644
    );
    inspectRegularReadableFile(
        helperPath,
        'embedded MPV frame-copy helper',
        errors,
        0o755
    );
    const staleWindowsHelper = path.join(nativeDir, 'iptvnator_mpv_helper.exe');
    if (pathExistsByLstat(staleWindowsHelper)) {
        errors.push(
            `Linux frame-copy package must not retain the Windows helper: ${staleWindowsHelper}`
        );
    }
    const staleMarker = path.join(nativeDir, 'embedded-mpv-unavailable.txt');
    if (pathExistsByLstat(staleMarker)) {
        errors.push(
            `Same-architecture Linux package must not retain the unavailable marker: ${staleMarker}`
        );
    }

    if (
        !inspectRegularReadableFile(
            manifestPath,
            'embedded MPV runtime manifest',
            errors
        )
    ) {
        return errors;
    }
    const manifest = readPackagedJson(
        manifestPath,
        'embedded MPV runtime manifest',
        errors
    );
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        if (manifest !== null) {
            errors.push('Embedded MPV runtime manifest must be an object.');
        }
        return errors;
    }

    validatePackagedManifestContract(manifest, profile, targetNames, errors);
    if (profile.runtimeMode === 'system') {
        validateSystemLinuxRuntime(nativeDir, manifest, errors);
    } else {
        validateBundledLinuxRuntime(nativeDir, manifest, errors);
    }
    inspectLinuxElfIsolation(resourceDir, nativeDir, manifest, options, errors);
    return errors;
}

function validatePackagedEmbeddedMpv(resourceDir, options = {}) {
    const platform = normalizeEmbeddedMpvPlatform(options.platform);
    if (platform === 'linux') {
        return validateLinuxPackagedEmbeddedMpv(resourceDir, options);
    }
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

    if (platform === 'darwin' || platform === 'win32') {
        // The frame-copy engine artifacts are built by the same binding.gyp
        // run as the addon; a macOS/Windows package that ships the addon
        // without them would silently lose the engine (support probe hides
        // it).
        const missingFrameCopyArtifacts = [
            platform === 'win32'
                ? 'iptvnator_mpv_helper.exe'
                : 'iptvnator_mpv_helper',
            'embedded_mpv_frame_reader.node',
        ]
            .map((name) => path.join(unpackedNativeDir, name))
            .filter((artifactPath) => !fs.existsSync(artifactPath));
        errors.push(
            ...missingFrameCopyArtifacts.map(
                (artifactPath) =>
                    `Missing embedded MPV frame-copy artifact: ${artifactPath}`
            )
        );

        if (platform === 'win32') {
            // The helper is a separate executable. Windows resolves its
            // imported libmpv DLL from the executable directory, so a copy
            // under native/lib may satisfy addon bookkeeping but cannot
            // start iptvnator_mpv_helper.exe.
            const helperPath = path.join(
                unpackedNativeDir,
                'iptvnator_mpv_helper.exe'
            );
            const helperRuntimeCandidates = windowsMpvRuntimeNames.map((name) =>
                path.join(unpackedNativeDir, name)
            );
            if (
                !helperRuntimeCandidates.some((candidate) =>
                    fs.existsSync(candidate)
                )
            ) {
                errors.push(
                    [
                        `Missing bundled MPV DLL beside the Windows frame-copy helper in ${unpackedNativeDir}.`,
                        'Expected one of:',
                        ...helperRuntimeCandidates.map(
                            (candidate) => `- ${candidate}`
                        ),
                    ].join('\n')
                );
            }

            if (fs.existsSync(helperPath)) {
                try {
                    const acceptedRuntimeNames = new Set(
                        windowsMpvRuntimeNames.map((name) => name.toLowerCase())
                    );
                    const importedRuntimeNames = readPeImportedDllNames(
                        helperPath
                    ).filter((name) =>
                        acceptedRuntimeNames.has(name.toLowerCase())
                    );
                    if (importedRuntimeNames.length === 0) {
                        errors.push(
                            `Windows frame-copy helper does not import a supported MPV DLL: ${helperPath}`
                        );
                    }

                    const packagedRuntimeNames = new Set(
                        fs
                            .readdirSync(unpackedNativeDir, {
                                withFileTypes: true,
                            })
                            .filter((entry) => entry.isFile())
                            .map((entry) => entry.name.toLowerCase())
                    );
                    for (const importedRuntimeName of importedRuntimeNames) {
                        if (
                            !packagedRuntimeNames.has(
                                importedRuntimeName.toLowerCase()
                            )
                        ) {
                            errors.push(
                                `Windows frame-copy helper imports ${importedRuntimeName}, but the matching DLL is missing beside it: ${path.join(unpackedNativeDir, importedRuntimeName)}`
                            );
                        }
                    }
                } catch (error) {
                    errors.push(
                        `Unable to inspect Windows frame-copy helper imports at ${helperPath}: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        }
    }

    if (!fs.existsSync(manifestPath)) {
        errors.push(`Missing embedded MPV runtime manifest: ${manifestPath}`);
    } else {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const expectedOrigin = 'vendored-lgpl';
        if (manifest.origin !== expectedOrigin) {
            errors.push(
                `Embedded MPV packaged runtime must be ${expectedOrigin}, received: ${manifest.origin}`
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
    listElectronShippedLinuxLibraries,
    listRuntimeFiles,
    listDylibs,
    parseOtoolDependencies,
    parseOtoolRpaths,
    patchAddonForBundledRuntime,
    validateNoForbiddenRuntimeLinks,
    getPackagedRuntimeCandidates,
    validatePackagedEmbeddedMpv,
    isForeignLinuxEmbeddedMpvArch,
    linuxUnpackedDirArch,
    resolveConfiguredLinuxTargetNames,
    resolveElectronBuilderArchName,
};
