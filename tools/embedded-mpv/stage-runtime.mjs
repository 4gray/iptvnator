import fs from 'fs';
import path from 'path';

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

try {
    assertExists(
        path.join(sourceIncludeDir, 'mpv', 'client.h'),
        'Missing libmpv header'
    );
    if (platform !== 'linux' && !findRuntimeFile(sourceLibDir)) {
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
    if (platform !== 'linux') {
        copyDirectory(sourceLibDir, destinationLibDir, runtimeFileFilter);
    }
    if (platform === 'win32') {
        copyDirectory(sourceBinDir, destinationLibDir, runtimeFileFilter);
    }

    const externalManifest =
        readJsonIfExists(
            path.join(normalizedPrefix, 'runtime-manifest.json')
        ) ?? {};
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
