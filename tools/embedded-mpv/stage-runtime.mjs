import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    isLinuxSystemBuildInputManifest,
    validateLinuxRuntimeManifest,
    validateLinuxSystemBuildInputManifest,
} = require('./linux-runtime-manifest.cjs');

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const [platform, arch, sourcePrefix] = args;
const workspaceRoot = process.cwd();
const validTargets = new Set([
    'darwin-arm64',
    'darwin-x64',
    'win32-x64',
    'linux-x64',
]);

if (!validTargets.has(`${platform}-${arch}`) || !sourcePrefix) {
    console.error(
        [
            'Usage: node tools/embedded-mpv/stage-runtime.mjs <darwin|win32|linux> <arch> <lgpl-runtime-prefix>',
            '',
            'Supported targets:',
            '- darwin arm64',
            '- darwin x64',
            '- win32 x64',
            '- linux x64',
            '',
            'The prefix must contain include/mpv/client.h. macOS and Windows prefixes must also contain dynamic libmpv runtime files.',
        ].join('\n')
    );
    process.exit(1);
}

const normalizedPrefix = path.resolve(sourcePrefix);
const destinationRoot = path.join(
    workspaceRoot,
    'vendor',
    'embedded-mpv',
    `${platform}-${arch}`
);
const destinationIncludeDir = path.join(destinationRoot, 'include');
const destinationLibDir = path.join(destinationRoot, 'lib');
const sourceIncludeDir = path.join(normalizedPrefix, 'include');
const sourceLibDir = path.join(normalizedPrefix, 'lib');
const sourceBinDir = path.join(normalizedPrefix, 'bin');

function assertExists(filePath, message) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${message}: ${filePath}`);
    }
}

function isFileLike(sourcePath, entry) {
    if (entry.isFile()) {
        return true;
    }

    if (!entry.isSymbolicLink()) {
        return false;
    }

    try {
        return fs.statSync(sourcePath).isFile();
    } catch {
        return false;
    }
}

function copyDirectory(sourceDir, destinationDir, filter) {
    if (!fs.existsSync(sourceDir)) {
        return;
    }

    fs.mkdirSync(destinationDir, { recursive: true });

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const destinationPath = path.join(destinationDir, entry.name);

        if (filter && !filter(sourcePath, entry)) {
            continue;
        }

        if (entry.isDirectory()) {
            copyDirectory(sourcePath, destinationPath, filter);
            continue;
        }

        if (isFileLike(sourcePath, entry)) {
            fs.copyFileSync(sourcePath, destinationPath);
            fs.chmodSync(destinationPath, 0o755);
        }
    }
}

function findRuntimeFile(libDir) {
    const candidatesByPlatform = {
        darwin: ['libmpv.2.dylib', 'libmpv.dylib'],
        win32: ['mpv-2.dll', 'libmpv-2.dll', 'mpv.dll', 'libmpv.dll'],
        linux: ['libmpv.so.2', 'libmpv.so.1', 'libmpv.so'],
    };
    const candidates = candidatesByPlatform[platform] ?? [];

    for (const candidate of candidates) {
        for (const directory of [libDir, sourceBinDir]) {
            const candidatePath = path.join(directory, candidate);
            if (fs.existsSync(candidatePath)) {
                return candidatePath;
            }
        }
    }

    return null;
}

function hasWindowsImportLibrary(libDir) {
    return ['mpv.lib', 'mpv-2.lib', 'libmpv.dll.a'].some((candidate) =>
        fs.existsSync(path.join(libDir, candidate))
    );
}

function runtimeFileFilter(_sourcePath, entry) {
    if (entry.isDirectory()) {
        return true;
    }

    if (platform === 'darwin') {
        return entry.name.endsWith('.dylib');
    }

    if (platform === 'win32') {
        return (
            entry.name.endsWith('.dll') ||
            entry.name.endsWith('.lib') ||
            entry.name.endsWith('.dll.a')
        );
    }

    if (platform === 'linux') {
        return /\.so(?:\.\d+)*$/.test(entry.name);
    }

    return false;
}

function listRuntimeFiles(libDir) {
    if (!fs.existsSync(libDir)) {
        return [];
    }

    return fs
        .readdirSync(libDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort();
}

function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readLinuxRuntimeManifest() {
    const manifestPath = path.join(normalizedPrefix, 'runtime-manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Missing Linux runtime manifest: ${manifestPath}`);
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
        throw new Error(
            `Invalid JSON in Linux runtime manifest ${manifestPath}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }

    const mode = isLinuxSystemBuildInputManifest(manifest)
        ? 'system-build-inputs'
        : 'bundled-runtime';
    const errors =
        mode === 'system-build-inputs'
            ? validateLinuxSystemBuildInputManifest(manifest)
            : validateLinuxRuntimeManifest(manifest);
    if (errors.length > 0) {
        throw new Error(
            ['Invalid Linux runtime manifest.', ...errors].join('\n')
        );
    }

    return { manifest, mode };
}

function sha256Contents(contents) {
    return crypto.createHash('sha256').update(contents).digest('hex');
}

function resolvePathInsideDirectory(filePath, directory, message) {
    const resolvedDirectory = fs.realpathSync(directory);
    const resolvedFilePath = fs.realpathSync(filePath);
    const relativePath = path.relative(resolvedDirectory, resolvedFilePath);
    if (
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    ) {
        throw new Error(`${message}: ${filePath}`);
    }

    return resolvedFilePath;
}

function readVerifiedLinuxRuntimeFiles(manifest) {
    return manifest.runtimeFiles.map((runtimeFile) => {
        const declaredSourcePath = path.join(sourceLibDir, runtimeFile.name);
        if (!fs.existsSync(declaredSourcePath)) {
            throw new Error(
                `Missing declared Linux runtime file: ${declaredSourcePath}`
            );
        }

        const sourcePath = resolvePathInsideDirectory(
            declaredSourcePath,
            sourceLibDir,
            'Declared Linux runtime file resolves outside prefix/lib'
        );
        const sourceStat = fs.statSync(sourcePath);
        if (!sourceStat.isFile()) {
            throw new Error(
                `Declared Linux runtime path is not a regular file: ${declaredSourcePath}`
            );
        }

        const contents = fs.readFileSync(sourcePath);
        if (contents.byteLength !== runtimeFile.size) {
            throw new Error(
                `Size mismatch for Linux runtime file ${declaredSourcePath}: expected ${runtimeFile.size}, received ${contents.byteLength}`
            );
        }

        const actualSha256 = sha256Contents(contents);
        if (actualSha256 !== runtimeFile.sha256) {
            throw new Error(
                `SHA-256 mismatch for Linux runtime file ${declaredSourcePath}: expected ${runtimeFile.sha256}, received ${actualSha256}`
            );
        }

        return { contents, runtimeFile };
    });
}

function readLinuxHeaderFiles() {
    resolvePathInsideDirectory(
        sourceIncludeDir,
        normalizedPrefix,
        'Linux include directory resolves outside source prefix'
    );

    const headerFiles = [];
    function visitDirectory(sourceDirectory, relativeDirectory) {
        for (const entry of fs.readdirSync(sourceDirectory, {
            withFileTypes: true,
        })) {
            const sourcePath = path.join(sourceDirectory, entry.name);
            const relativePath = path.join(relativeDirectory, entry.name);
            if (entry.isDirectory()) {
                visitDirectory(sourcePath, relativePath);
                continue;
            }
            if (!entry.isFile() && !entry.isSymbolicLink()) {
                continue;
            }

            const resolvedSourcePath = resolvePathInsideDirectory(
                sourcePath,
                sourceIncludeDir,
                'Linux header resolves outside prefix/include'
            );
            if (!fs.statSync(resolvedSourcePath).isFile()) {
                throw new Error(
                    `Linux header is not a regular file: ${sourcePath}`
                );
            }
            headerFiles.push({
                contents: fs.readFileSync(resolvedSourcePath),
                relativePath,
            });
        }
    }

    visitDirectory(path.join(sourceIncludeDir, 'mpv'), 'mpv');
    return headerFiles;
}

function lstatIfExists(filePath) {
    try {
        return fs.lstatSync(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

function assertSafeLinuxDestinationPath() {
    const relativeDestination = path.relative(workspaceRoot, destinationRoot);
    if (
        relativeDestination === '..' ||
        relativeDestination.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeDestination)
    ) {
        throw new Error(
            `Linux runtime destination escapes the workspace: ${destinationRoot}`
        );
    }

    let currentPath = workspaceRoot;
    for (const segment of relativeDestination.split(path.sep)) {
        currentPath = path.join(currentPath, segment);
        const stat = lstatIfExists(currentPath);
        if (stat?.isSymbolicLink()) {
            throw new Error(
                `Linux runtime destination path contains a symbolic link: ${currentPath}`
            );
        }
    }
}

function createLinuxStagedManifest(externalManifest, mode) {
    return {
        ...externalManifest,
        origin: 'vendored-lgpl',
        ...(mode === 'bundled-runtime'
            ? { sourceBuildOrigin: externalManifest.origin }
            : {}),
        platform,
        arch,
        stagedAt: new Date().toISOString(),
        runtimeFiles:
            mode === 'bundled-runtime'
                ? externalManifest.runtimeFiles.map((runtimeFile) => ({
                      ...runtimeFile,
                  }))
                : [],
        ffmpeg: {
            licensePolicy:
                'LGPL, built without --enable-gpl and --enable-nonfree',
            ...externalManifest.ffmpeg,
            configureFlags:
                externalManifest.ffmpeg?.configureFlags ??
                'Record the exact FFmpeg configure flags used to build this runtime.',
        },
        mpv: {
            licensePolicy:
                'LGPL-compatible libmpv, built with -Dlibmpv=true -Dgpl=false',
            ...externalManifest.mpv,
            mesonFlags:
                externalManifest.mpv?.mesonFlags ??
                'Record the exact mpv Meson flags used to build this runtime.',
        },
        sourceDistribution: externalManifest.sourceDistribution,
    };
}

function writeLinuxStagingTree(
    stagingRoot,
    headerFiles,
    verifiedRuntimeFiles,
    stagedManifest
) {
    for (const headerFile of headerFiles) {
        const destinationPath = path.join(
            stagingRoot,
            'include',
            headerFile.relativePath
        );
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.writeFileSync(destinationPath, headerFile.contents);
        fs.chmodSync(destinationPath, 0o644);
    }

    for (const verifiedRuntimeFile of verifiedRuntimeFiles) {
        const destinationPath = path.join(
            stagingRoot,
            'lib',
            verifiedRuntimeFile.runtimeFile.name
        );
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.writeFileSync(destinationPath, verifiedRuntimeFile.contents);
        fs.chmodSync(destinationPath, 0o755);
    }

    fs.writeFileSync(
        path.join(stagingRoot, 'runtime-manifest.json'),
        `${JSON.stringify(stagedManifest, null, 2)}\n`
    );
}

function publishLinuxStagingTree(stagingRoot) {
    const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    const backupRoot = path.join(
        path.dirname(destinationRoot),
        `.linux-x64.backup-${token}`
    );
    let movedPreviousDestination = false;

    try {
        assertSafeLinuxDestinationPath();
        const destinationStat = lstatIfExists(destinationRoot);
        if (destinationStat && !destinationStat.isDirectory()) {
            throw new Error(
                `Linux runtime destination is not a directory: ${destinationRoot}`
            );
        }
        if (destinationStat) {
            fs.renameSync(destinationRoot, backupRoot);
            movedPreviousDestination = true;
        }

        fs.renameSync(stagingRoot, destinationRoot);
        if (movedPreviousDestination) {
            fs.rmSync(backupRoot, { recursive: true, force: true });
        }
    } catch (error) {
        if (
            movedPreviousDestination &&
            !lstatIfExists(destinationRoot) &&
            lstatIfExists(backupRoot)
        ) {
            fs.renameSync(backupRoot, destinationRoot);
        }
        throw error;
    } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
        if (lstatIfExists(destinationRoot)) {
            fs.rmSync(backupRoot, { recursive: true, force: true });
        }
    }
}

function stageLinuxRuntime(headerFiles, verifiedRuntimeFiles, stagedManifest) {
    assertSafeLinuxDestinationPath();
    const destinationParent = path.dirname(destinationRoot);
    fs.mkdirSync(destinationParent, { recursive: true });
    assertSafeLinuxDestinationPath();

    const stagingRoot = path.join(
        destinationParent,
        `.linux-x64.stage-${process.pid}-${crypto
            .randomBytes(8)
            .toString('hex')}`
    );
    fs.mkdirSync(stagingRoot);
    try {
        writeLinuxStagingTree(
            stagingRoot,
            headerFiles,
            verifiedRuntimeFiles,
            stagedManifest
        );
        publishLinuxStagingTree(stagingRoot);
    } catch (error) {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
        throw error;
    }
}

try {
    assertExists(
        path.join(sourceIncludeDir, 'mpv', 'client.h'),
        'Missing libmpv header'
    );

    if (platform === 'linux') {
        const { manifest: externalManifest, mode } = readLinuxRuntimeManifest();
        const headerFiles = readLinuxHeaderFiles();
        const verifiedRuntimeFiles =
            mode === 'bundled-runtime'
                ? readVerifiedLinuxRuntimeFiles(externalManifest)
                : [];
        stageLinuxRuntime(
            headerFiles,
            verifiedRuntimeFiles,
            createLinuxStagedManifest(externalManifest, mode)
        );
    } else {
        const externalManifest =
            readJsonIfExists(
                path.join(normalizedPrefix, 'runtime-manifest.json')
            ) ?? {};
        if (!findRuntimeFile(sourceLibDir)) {
            throw new Error(
                `Missing libmpv runtime for ${platform} in ${sourceLibDir}`
            );
        }
        if (platform === 'win32' && !hasWindowsImportLibrary(sourceLibDir)) {
            throw new Error(
                `Missing Windows libmpv import library in ${sourceLibDir}`
            );
        }

        fs.rmSync(destinationIncludeDir, { recursive: true, force: true });
        fs.rmSync(destinationLibDir, { recursive: true, force: true });
        fs.mkdirSync(destinationRoot, { recursive: true });

        copyDirectory(
            path.join(sourceIncludeDir, 'mpv'),
            path.join(destinationIncludeDir, 'mpv')
        );
        copyDirectory(sourceLibDir, destinationLibDir, runtimeFileFilter);
        if (platform === 'win32') {
            copyDirectory(sourceBinDir, destinationLibDir, runtimeFileFilter);
        }

        const manifest = {
            ...externalManifest,
            origin: 'vendored-lgpl',
            platform,
            arch,
            stagedAt: new Date().toISOString(),
            runtimeFiles: listRuntimeFiles(destinationLibDir),
            ffmpeg: {
                licensePolicy:
                    'LGPL, built without --enable-gpl and --enable-nonfree',
                ...externalManifest.ffmpeg,
                configureFlags:
                    externalManifest.ffmpeg?.configureFlags ??
                    'Record the exact FFmpeg configure flags used to build this runtime.',
            },
            mpv: {
                licensePolicy:
                    'LGPL-compatible libmpv, built with -Dlibmpv=true -Dgpl=false',
                ...externalManifest.mpv,
                mesonFlags:
                    externalManifest.mpv?.mesonFlags ??
                    'Record the exact mpv Meson flags used to build this runtime.',
            },
            sourceDistribution:
                externalManifest.sourceDistribution ??
                `Publish exact source archives and local patches with the ${platform}-${arch} binary release.`,
        };

        fs.writeFileSync(
            path.join(destinationRoot, 'runtime-manifest.json'),
            `${JSON.stringify(manifest, null, 2)}\n`
        );
    }

    console.log(
        `Staged embedded MPV runtime for ${platform}-${arch} at ${path.relative(
            workspaceRoot,
            destinationRoot
        )}`
    );
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
