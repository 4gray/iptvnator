#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const [archiveSource, rawExpectedSha256] = args;
const workspaceRoot = process.cwd();
const windowsArch = 'x64';

if (!archiveSource || !rawExpectedSha256) {
    console.error(
        [
            'Usage: node tools/embedded-mpv/stage-windows-runtime-archive.mjs <archive-url-or-path> <sha256>',
            '',
            'Downloads or reads a checksum-pinned LGPL-compatible Windows libmpv runtime archive,',
            'extracts it, and stages it as vendor/embedded-mpv/win32-x64.',
            '',
            'The archive must contain a prefix with:',
            '- include/mpv/client.h',
            '- mpv.lib, mpv-2.lib, or libmpv.dll.a in the prefix root or lib/',
            '- mpv-2.dll, libmpv-2.dll, mpv.dll, or libmpv.dll in the prefix root, bin/, or lib/',
            '- optional runtime-manifest.json with source/build metadata',
        ].join('\n')
    );
    process.exit(1);
}

function log(message) {
    process.stdout.write(`[embedded-mpv-windows-runtime] ${message}\n`);
}

function isHttpsUrl(value) {
    try {
        const parsedUrl = new URL(value);
        return parsedUrl.protocol === 'https:';
    } catch {
        return false;
    }
}

function normalizeSha256(value) {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/^sha256[:=\s-]*/, '');

    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error('Expected SHA-256 must be a 64-character hex digest.');
    }

    return normalized;
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}

function run(command, commandArgs, options = {}) {
    log(`${command} ${commandArgs.join(' ')}`);
    const result = spawnSync(command, commandArgs, {
        cwd: options.cwd ?? workspaceRoot,
        env: options.env ?? process.env,
        stdio: 'inherit',
        ...options,
    });

    if (result.status !== 0) {
        throw new Error(
            `${command} ${commandArgs.join(' ')} failed with status ${
                result.status ?? 1
            }.`
        );
    }
}

function runResult(command, commandArgs, options = {}) {
    log(`${command} ${commandArgs.join(' ')}`);
    return spawnSync(command, commandArgs, {
        cwd: options.cwd ?? workspaceRoot,
        env: options.env ?? process.env,
        stdio: 'inherit',
        ...options,
    });
}

async function downloadArchive(sourceUrl, destinationPath) {
    const response = await fetch(sourceUrl);
    if (!response.ok || !response.body) {
        throw new Error(
            `Unable to download Windows embedded MPV runtime archive: ${response.status} ${response.statusText}`
        );
    }

    await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(destinationPath)
    );
}

function archiveNameForSource(source) {
    if (!isHttpsUrl(source)) {
        return path.basename(source);
    }

    const parsedUrl = new URL(source);
    const archiveName = path.basename(parsedUrl.pathname);
    return archiveName || 'windows-embedded-mpv-runtime.zip';
}

function findWindowsImportLibrary(prefix) {
    return ['mpv.lib', 'mpv-2.lib', 'libmpv.dll.a']
        .flatMap((candidate) => [
            path.join(prefix, 'lib', candidate),
            path.join(prefix, candidate),
        ])
        .find((candidatePath) => fs.existsSync(candidatePath));
}

function findWindowsDll(prefix) {
    return ['mpv-2.dll', 'libmpv-2.dll', 'mpv.dll', 'libmpv.dll']
        .flatMap((candidate) => [
            path.join(prefix, 'bin', candidate),
            path.join(prefix, 'lib', candidate),
            path.join(prefix, candidate),
        ])
        .find((candidatePath) => fs.existsSync(candidatePath));
}

function hasRuntimePrefixLayout(candidateDir) {
    return (
        fs.existsSync(path.join(candidateDir, 'include', 'mpv', 'client.h')) &&
        Boolean(findWindowsImportLibrary(candidateDir)) &&
        Boolean(findWindowsDll(candidateDir))
    );
}

function findRuntimePrefix(extractRoot) {
    const queue = [{ directory: extractRoot, depth: 0 }];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }

        if (hasRuntimePrefixLayout(current.directory)) {
            return current.directory;
        }

        if (current.depth >= 5) {
            continue;
        }

        for (const entry of fs.readdirSync(current.directory, {
            withFileTypes: true,
        })) {
            if (!entry.isDirectory()) {
                continue;
            }

            queue.push({
                directory: path.join(current.directory, entry.name),
                depth: current.depth + 1,
            });
        }
    }

    return null;
}

function copyDirectory(sourceDir, destinationDir) {
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.cpSync(sourceDir, destinationDir, { recursive: true });
}

function copyFile(sourcePath, destinationPath) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
}

function writeGeneratedManifest(destinationPath, archiveSha256) {
    const manifest = {
        sourceDistribution: archiveSource,
        archive: {
            urlOrPath: archiveSource,
            sha256: archiveSha256,
        },
        ffmpeg: {
            licensePolicy:
                'LGPL-compatible Windows runtime archive supplied to CI.',
            configureFlags:
                'Record exact FFmpeg configure flags in the upstream runtime manifest when available.',
        },
        mpv: {
            licensePolicy:
                'LGPL-compatible libmpv Windows runtime archive supplied to CI.',
            mesonFlags:
                'Record exact mpv Meson flags in the upstream runtime manifest when available.',
        },
    };

    fs.writeFileSync(destinationPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function normalizeRuntimePrefix(runtimePrefix, tempRoot, archiveSha256) {
    const normalizedPrefix = path.join(tempRoot, 'normalized-prefix');
    const importLibrary = findWindowsImportLibrary(runtimePrefix);
    const runtimeDll = findWindowsDll(runtimePrefix);

    if (!importLibrary || !runtimeDll) {
        throw new Error(
            `Incomplete Windows embedded MPV runtime prefix: ${runtimePrefix}`
        );
    }

    fs.rmSync(normalizedPrefix, { recursive: true, force: true });
    fs.mkdirSync(normalizedPrefix, { recursive: true });
    copyDirectory(
        path.join(runtimePrefix, 'include', 'mpv'),
        path.join(normalizedPrefix, 'include', 'mpv')
    );
    copyFile(
        importLibrary,
        path.join(normalizedPrefix, 'lib', path.basename(importLibrary))
    );
    copyFile(
        runtimeDll,
        path.join(normalizedPrefix, 'bin', path.basename(runtimeDll))
    );

    const sourceManifestPath = path.join(
        runtimePrefix,
        'runtime-manifest.json'
    );
    const normalizedManifestPath = path.join(
        normalizedPrefix,
        'runtime-manifest.json'
    );
    if (fs.existsSync(sourceManifestPath)) {
        copyFile(sourceManifestPath, normalizedManifestPath);
    } else {
        writeGeneratedManifest(normalizedManifestPath, archiveSha256);
    }

    return normalizedPrefix;
}

function commandExists(command) {
    const result = spawnSync(
        process.platform === 'win32' ? 'where' : 'sh',
        process.platform === 'win32'
            ? [command]
            : ['-lc', `command -v ${command}`],
        { stdio: 'ignore' }
    );
    return result.status === 0;
}

function extractArchive(archivePath, extractRoot) {
    const tarResult = runResult(
        'tar',
        ['-xf', archivePath, '-C', extractRoot],
        {
            stdio: 'pipe',
        }
    );
    if (tarResult.status === 0) {
        return;
    }

    if (commandExists('7z')) {
        run('7z', ['x', `-o${extractRoot}`, archivePath]);
        return;
    }

    throw new Error(
        `Unable to extract ${archivePath}. Install tar with archive support or 7z.`
    );
}

async function main() {
    const expectedSha256 = normalizeSha256(rawExpectedSha256);
    const tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-windows-embedded-mpv-')
    );
    const archivePath = isHttpsUrl(archiveSource)
        ? path.join(tempRoot, archiveNameForSource(archiveSource))
        : path.resolve(archiveSource);
    const extractRoot = path.join(tempRoot, 'extract');

    try {
        if (isHttpsUrl(archiveSource)) {
            log(`Downloading runtime archive from ${archiveSource}`);
            await downloadArchive(archiveSource, archivePath);
        }

        if (!fs.existsSync(archivePath)) {
            throw new Error(`Runtime archive does not exist: ${archivePath}`);
        }

        const actualSha256 = await sha256File(archivePath);
        if (actualSha256 !== expectedSha256) {
            throw new Error(
                `Windows embedded MPV runtime checksum mismatch. Expected ${expectedSha256}, received ${actualSha256}.`
            );
        }

        fs.mkdirSync(extractRoot, { recursive: true });
        extractArchive(archivePath, extractRoot);

        const runtimePrefix = findRuntimePrefix(extractRoot);
        if (!runtimePrefix) {
            throw new Error(
                [
                    'Unable to find a Windows embedded MPV runtime prefix in the archive.',
                    'Expected include/mpv/client.h, a Windows import library, and mpv-2.dll/libmpv-2.dll/mpv.dll/libmpv.dll.',
                ].join('\n')
            );
        }
        const normalizedPrefix = normalizeRuntimePrefix(
            runtimePrefix,
            tempRoot,
            expectedSha256
        );

        run(process.execPath, [
            path.join(
                workspaceRoot,
                'tools',
                'embedded-mpv',
                'stage-runtime.mjs'
            ),
            'win32',
            windowsArch,
            normalizedPrefix,
        ]);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
