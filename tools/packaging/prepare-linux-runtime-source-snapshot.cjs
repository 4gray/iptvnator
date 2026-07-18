#!/usr/bin/env node

'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const {
    canonicalizeGitSubmoduleStatus,
} = require('../embedded-mpv/build-linux-runtime.cjs');

const GIT_COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const LINUX_RUNTIME_SOURCE_SNAPSHOT_CONTRACT = Object.freeze({
    schemaVersion: 1,
    hashAlgorithm: 'sha256',
    canonicalEncoding: 'utf8-json-line-v1',
});

// Derived from a clean recursive checkout of libplacebo v7.360.1 at
// cee9b076f2c63104ccfd497fa79c39a867293ec4 with every recorded submodule at
// its pinned commit. The inventory contract above excludes all .git entries.
// Derivation: git clone --branch v7.360.1 --single-branch --recurse-submodules
// https://github.com/haasn/libplacebo.git, then globally sort and inventory the
// VCS-free copy under LINUX_RUNTIME_SOURCE_SNAPSHOT_CONTRACT.
// The trusted snapshot has 1,456 entries and 54,312,340 regular-file bytes.
const EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SNAPSHOT_SHA256 =
    '0db67c1523411255244186af437e9fbfe7ccac04a5ac1b3dc9275dd0806f6f0c';

function gitOutput(checkoutPath, ...args) {
    try {
        return childProcess
            .execFileSync('git', ['-C', checkoutPath, ...args], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            })
            .trim();
    } catch (error) {
        const stderr =
            error && typeof error === 'object' && 'stderr' in error
                ? String(error.stderr).trim()
                : '';
        throw new Error(
            `Unable to inspect source checkout with git ${args.join(' ')}${stderr ? `: ${stderr}` : '.'}`
        );
    }
}

function assertExpectedGitRecord(expected) {
    if (
        expected === null ||
        typeof expected !== 'object' ||
        typeof expected.sourceGitCommit !== 'string' ||
        !GIT_COMMIT_PATTERN.test(expected.sourceGitCommit) ||
        !Array.isArray(expected.sourceSubmodules) ||
        expected.sourceSubmodules.some(
            (record) => typeof record !== 'string' || record.length === 0
        )
    ) {
        throw new Error(
            'Expected source identity must contain one commit and a submodule record array.'
        );
    }
}

function assertCleanCheckout(checkoutPath, label) {
    const status = gitOutput(
        checkoutPath,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--ignore-submodules=none'
    );
    if (status) {
        throw new Error(`${label} checkout contains dirty or untracked files.`);
    }
}

function sourceSubmoduleIdentity(record) {
    const match = record.match(/^([a-f0-9]{40,64})\s+([A-Za-z0-9_+./-]+)$/);
    if (!match) {
        throw new Error(`Invalid source submodule record: ${record}`);
    }
    const submodulePath = match[2];
    if (
        path.isAbsolute(submodulePath) ||
        submodulePath
            .split('/')
            .some((part) => part === '' || part === '.' || part === '..')
    ) {
        throw new Error(`Unsafe source submodule path: ${submodulePath}`);
    }
    return {
        commit: match[1],
        path: submodulePath,
    };
}

function inspectCleanGitSource(checkoutPath, expected) {
    assertExpectedGitRecord(expected);
    const sourceGitCommit = gitOutput(checkoutPath, 'rev-parse', 'HEAD');
    if (sourceGitCommit !== expected.sourceGitCommit) {
        throw new Error(
            'Source checkout commit does not match the runtime manifest.'
        );
    }
    const submoduleOutput = gitOutput(
        checkoutPath,
        'submodule',
        'status',
        '--recursive'
    );
    const sourceSubmodules = canonicalizeGitSubmoduleStatus(submoduleOutput);
    if (!isDeepStrictEqual(sourceSubmodules, expected.sourceSubmodules)) {
        throw new Error(
            'Source checkout submodules do not match the runtime manifest.'
        );
    }

    assertCleanCheckout(checkoutPath, 'Source');
    for (const submoduleRecord of sourceSubmodules) {
        const submodule = sourceSubmoduleIdentity(submoduleRecord);
        const submoduleCheckout = path.join(
            checkoutPath,
            ...submodule.path.split('/')
        );
        if (
            gitOutput(submoduleCheckout, 'rev-parse', 'HEAD') !==
            submodule.commit
        ) {
            throw new Error(
                `Source submodule ${submodule.path} commit does not match its recorded identity.`
            );
        }
        assertCleanCheckout(
            submoduleCheckout,
            `Source submodule ${submodule.path}`
        );
    }
    return {
        sourceGitCommit,
        sourceSubmodules,
    };
}

function gitMetadataEntries(rootPath) {
    const entries = [];
    function visit(directoryPath, relativeDirectory = '') {
        for (const entry of fs.readdirSync(directoryPath, {
            withFileTypes: true,
        })) {
            const relativePath = path.posix.join(relativeDirectory, entry.name);
            const absolutePath = path.join(directoryPath, entry.name);
            if (entry.name === '.git') {
                entries.push(relativePath);
            } else if (entry.isDirectory()) {
                visit(absolutePath, relativePath);
            }
        }
    }
    visit(rootPath);
    return entries.sort();
}

function assertNoGitMetadata(rootPath) {
    const entries = gitMetadataEntries(rootPath);
    if (entries.length > 0) {
        throw new Error(
            `Prepared source snapshot must not contain VCS metadata: ${entries.join(', ')}`
        );
    }
}

function compareCanonicalPaths(left, right) {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}

function sha256File(filePath) {
    const descriptor = fs.openSync(filePath, 'r');
    try {
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile()) {
            throw new Error(
                `Unsupported source snapshot entry (not a regular file): ${filePath}`
            );
        }
        if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
            throw new Error(
                `Source snapshot file has an unsupported size: ${filePath}`
            );
        }
        const hash = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let offset = 0;
        while (offset < stat.size) {
            const bytesRead = fs.readSync(
                descriptor,
                buffer,
                0,
                Math.min(buffer.length, stat.size - offset),
                offset
            );
            if (bytesRead === 0) {
                throw new Error(
                    `Source snapshot file changed while hashing: ${filePath}`
                );
            }
            hash.update(buffer.subarray(0, bytesRead));
            offset += bytesRead;
        }
        const finalStat = fs.fstatSync(descriptor);
        if (
            !finalStat.isFile() ||
            finalStat.size !== stat.size ||
            finalStat.mtimeMs !== stat.mtimeMs
        ) {
            throw new Error(
                `Source snapshot file changed while hashing: ${filePath}`
            );
        }
        return {
            size: stat.size,
            executable: (stat.mode & 0o111) !== 0,
            sha256: hash.digest('hex'),
        };
    } finally {
        fs.closeSync(descriptor);
    }
}

function assertSafeSnapshotPath(relativePath) {
    if (
        typeof relativePath !== 'string' ||
        relativePath.length === 0 ||
        relativePath.includes('\\') ||
        path.posix.isAbsolute(relativePath) ||
        path.win32.isAbsolute(relativePath) ||
        [...relativePath].some((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint <= 0x1f || codePoint === 0x7f;
        }) ||
        relativePath
            .split('/')
            .some(
                (part) =>
                    part === '' ||
                    part === '.' ||
                    part === '..' ||
                    part === '.git'
            )
    ) {
        throw new Error(`Unsafe source snapshot path: ${relativePath}`);
    }
}

function assertSafeSymlinkTarget(relativePath, target) {
    const targetSegments = target.split('/');
    const resolvedTarget = path.posix.normalize(
        path.posix.join(path.posix.dirname(relativePath), target)
    );
    if (
        target.length === 0 ||
        target.includes('\\') ||
        path.posix.isAbsolute(target) ||
        path.win32.isAbsolute(target) ||
        [...target].some((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint <= 0x1f || codePoint === 0x7f;
        }) ||
        resolvedTarget === '..' ||
        resolvedTarget.startsWith('../') ||
        path.posix.isAbsolute(resolvedTarget) ||
        targetSegments.includes('.git')
    ) {
        throw new Error(
            `Unsafe source snapshot symlink ${relativePath}: ${target}`
        );
    }
}

function hasExactFields(value, expectedFields) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        isDeepStrictEqual(
            Object.keys(value).sort(compareCanonicalPaths),
            [...expectedFields].sort(compareCanonicalPaths)
        )
    );
}

function canonicalSourceSnapshotSha256({
    schemaVersion,
    entryCount,
    totalBytes,
    entries,
}) {
    return crypto
        .createHash('sha256')
        .update(
            `${JSON.stringify({
                schemaVersion,
                entryCount,
                totalBytes,
                entries,
            })}\n`,
            'utf8'
        )
        .digest('hex');
}

function invalidSourceSnapshot(detail) {
    throw new Error(`Invalid source snapshot: ${detail}`);
}

function validateLinuxRuntimeSourceSnapshot(snapshot, { expectedSha256 } = {}) {
    if (
        !hasExactFields(snapshot, [
            'schemaVersion',
            'sha256',
            'entryCount',
            'totalBytes',
            'entries',
        ]) ||
        snapshot.schemaVersion !==
            LINUX_RUNTIME_SOURCE_SNAPSHOT_CONTRACT.schemaVersion ||
        typeof snapshot.sha256 !== 'string' ||
        !SHA256_PATTERN.test(snapshot.sha256) ||
        !Number.isSafeInteger(snapshot.entryCount) ||
        snapshot.entryCount < 0 ||
        !Number.isSafeInteger(snapshot.totalBytes) ||
        snapshot.totalBytes < 0 ||
        !Array.isArray(snapshot.entries)
    ) {
        invalidSourceSnapshot('top-level fields do not match the contract.');
    }

    const entries = [];
    const entryTypes = new Map();
    let previousPath = null;
    let totalBytes = 0;
    for (const entry of snapshot.entries) {
        if (
            entry === null ||
            typeof entry !== 'object' ||
            Array.isArray(entry) ||
            typeof entry.path !== 'string'
        ) {
            invalidSourceSnapshot('an entry is not an exact object.');
        }
        assertSafeSnapshotPath(entry.path);
        if (
            previousPath !== null &&
            compareCanonicalPaths(previousPath, entry.path) >= 0
        ) {
            throw new Error(
                'Invalid source snapshot: entry paths must be sorted and unique.'
            );
        }
        previousPath = entry.path;

        let normalizedEntry;
        if (entry.type === 'directory') {
            if (!hasExactFields(entry, ['path', 'type'])) {
                invalidSourceSnapshot(
                    `directory entry ${entry.path} has invalid fields.`
                );
            }
            normalizedEntry = {
                path: entry.path,
                type: 'directory',
            };
        } else if (entry.type === 'file') {
            if (
                !hasExactFields(entry, [
                    'path',
                    'type',
                    'size',
                    'executable',
                    'sha256',
                ]) ||
                !Number.isSafeInteger(entry.size) ||
                entry.size < 0 ||
                typeof entry.executable !== 'boolean' ||
                typeof entry.sha256 !== 'string' ||
                !SHA256_PATTERN.test(entry.sha256)
            ) {
                invalidSourceSnapshot(
                    `file entry ${entry.path} has invalid fields.`
                );
            }
            totalBytes += entry.size;
            if (!Number.isSafeInteger(totalBytes)) {
                invalidSourceSnapshot(
                    'regular-file byte total exceeds the supported range.'
                );
            }
            normalizedEntry = {
                path: entry.path,
                type: 'file',
                size: entry.size,
                executable: entry.executable,
                sha256: entry.sha256,
            };
        } else if (entry.type === 'symlink') {
            if (
                !hasExactFields(entry, ['path', 'type', 'target']) ||
                typeof entry.target !== 'string'
            ) {
                invalidSourceSnapshot(
                    `symlink entry ${entry.path} has invalid fields.`
                );
            }
            assertSafeSymlinkTarget(entry.path, entry.target);
            normalizedEntry = {
                path: entry.path,
                type: 'symlink',
                target: entry.target,
            };
        } else {
            invalidSourceSnapshot(
                `entry ${entry.path} has an unsupported type.`
            );
        }

        const parentPath = path.posix.dirname(entry.path);
        if (parentPath !== '.' && entryTypes.get(parentPath) !== 'directory') {
            throw new Error(
                `Invalid source snapshot: parent ${parentPath} of ${entry.path} must be a directory entry.`
            );
        }
        entryTypes.set(entry.path, entry.type);
        entries.push(normalizedEntry);
    }

    if (
        snapshot.entryCount !== entries.length ||
        snapshot.totalBytes !== totalBytes
    ) {
        invalidSourceSnapshot(
            'entryCount or totalBytes does not match the entries.'
        );
    }
    const normalizedSnapshot = {
        schemaVersion: LINUX_RUNTIME_SOURCE_SNAPSHOT_CONTRACT.schemaVersion,
        sha256: snapshot.sha256,
        entryCount: entries.length,
        totalBytes,
        entries,
    };
    const canonicalSha256 = canonicalSourceSnapshotSha256(normalizedSnapshot);
    if (snapshot.sha256 !== canonicalSha256) {
        invalidSourceSnapshot('canonical SHA-256 does not match the entries.');
    }
    assertExpectedSourceSnapshot(normalizedSnapshot, expectedSha256);
    return normalizedSnapshot;
}

function inventoryLinuxRuntimeSourceSnapshot(rootPath) {
    const rootStat = fs.lstatSync(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error('Source snapshot root must be a real directory.');
    }
    assertNoGitMetadata(rootPath);
    const entries = [];
    let totalBytes = 0;

    function visit(directoryPath, relativeDirectory = '') {
        const childNames = fs
            .readdirSync(directoryPath)
            .sort(compareCanonicalPaths);
        for (const childName of childNames) {
            const relativePath = relativeDirectory
                ? `${relativeDirectory}/${childName}`
                : childName;
            assertSafeSnapshotPath(relativePath);
            const absolutePath = path.join(directoryPath, childName);
            const stat = fs.lstatSync(absolutePath);
            if (stat.isDirectory()) {
                entries.push({
                    path: relativePath,
                    type: 'directory',
                });
                visit(absolutePath, relativePath);
                continue;
            }
            if (stat.isFile()) {
                const file = sha256File(absolutePath);
                totalBytes += file.size;
                if (!Number.isSafeInteger(totalBytes)) {
                    throw new Error(
                        'Source snapshot total byte count exceeds the supported range.'
                    );
                }
                entries.push({
                    path: relativePath,
                    type: 'file',
                    size: file.size,
                    executable: file.executable,
                    sha256: file.sha256,
                });
                continue;
            }
            if (stat.isSymbolicLink()) {
                const target = fs.readlinkSync(absolutePath);
                assertSafeSymlinkTarget(relativePath, target);
                entries.push({
                    path: relativePath,
                    type: 'symlink',
                    target,
                });
                continue;
            }
            throw new Error(
                `Unsupported source snapshot entry: ${relativePath}`
            );
        }
    }

    visit(rootPath);
    entries.sort(({ path: left }, { path: right }) =>
        compareCanonicalPaths(left, right)
    );
    const canonicalInventory = {
        schemaVersion: LINUX_RUNTIME_SOURCE_SNAPSHOT_CONTRACT.schemaVersion,
        entryCount: entries.length,
        totalBytes,
        entries,
    };
    const sha256 = canonicalSourceSnapshotSha256(canonicalInventory);
    return {
        schemaVersion: canonicalInventory.schemaVersion,
        sha256,
        entryCount: canonicalInventory.entryCount,
        totalBytes: canonicalInventory.totalBytes,
        entries,
    };
}

function lstatIfExists(candidatePath) {
    try {
        return fs.lstatSync(candidatePath);
    } catch (error) {
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
        ) {
            return null;
        }
        throw error;
    }
}

function assertExpectedSourceSnapshot(
    sourceSnapshot,
    expectedSourceSnapshotSha256
) {
    if (expectedSourceSnapshotSha256 === undefined) {
        return;
    }
    if (
        typeof expectedSourceSnapshotSha256 !== 'string' ||
        !SHA256_PATTERN.test(expectedSourceSnapshotSha256)
    ) {
        throw new Error(
            'Expected source snapshot digest must be a lowercase SHA-256 digest.'
        );
    }
    if (sourceSnapshot.sha256 !== expectedSourceSnapshotSha256) {
        throw new Error(
            `Source snapshot digest mismatch: expected ${expectedSourceSnapshotSha256}, received ${sourceSnapshot.sha256}.`
        );
    }
}

function copyWorkingTreeWithoutGitMetadata(
    checkoutPath,
    outputPath,
    expectedSourceSnapshotSha256
) {
    const outputParent = path.dirname(outputPath);
    const temporaryPath = fs.mkdtempSync(
        path.join(outputParent, `.${path.basename(outputPath)}-`)
    );
    try {
        fs.cpSync(checkoutPath, temporaryPath, {
            recursive: true,
            dereference: false,
            verbatimSymlinks: true,
            filter: (sourcePath) => path.basename(sourcePath) !== '.git',
        });
        assertNoGitMetadata(temporaryPath);
        const sourceSnapshot =
            inventoryLinuxRuntimeSourceSnapshot(temporaryPath);
        assertExpectedSourceSnapshot(
            sourceSnapshot,
            expectedSourceSnapshotSha256
        );
        if (lstatIfExists(outputPath)) {
            throw new Error(
                `Prepared source snapshot output must not already exist: ${outputPath}`
            );
        }
        fs.renameSync(temporaryPath, outputPath);
        return sourceSnapshot;
    } catch (error) {
        fs.rmSync(temporaryPath, { recursive: true, force: true });
        throw error;
    }
}

function prepareLinuxRuntimeSourceSnapshot({
    checkoutPath,
    outputPath,
    expected,
    expectedSourceSnapshotSha256,
}) {
    const checkoutStat = fs.lstatSync(checkoutPath);
    if (!checkoutStat.isDirectory() || checkoutStat.isSymbolicLink()) {
        throw new Error('Source checkout must be a real directory.');
    }
    const checkoutRoot = fs.realpathSync(checkoutPath);
    const outputRoot = path.resolve(outputPath);
    const outputParent = path.dirname(outputRoot);
    const outputParentStat = fs.lstatSync(outputParent);
    if (!outputParentStat.isDirectory() || outputParentStat.isSymbolicLink()) {
        throw new Error(
            'Prepared source snapshot parent must be a real directory.'
        );
    }
    if (lstatIfExists(outputRoot)) {
        throw new Error(
            `Prepared source snapshot output must not already exist: ${outputRoot}`
        );
    }
    const realOutputRoot = path.join(
        fs.realpathSync(outputParent),
        path.basename(outputRoot)
    );
    const isInside = (root, candidate) => {
        const relative = path.relative(root, candidate);
        return (
            relative === '' ||
            (relative !== '..' &&
                !relative.startsWith(`..${path.sep}`) &&
                !path.isAbsolute(relative))
        );
    };
    if (
        isInside(checkoutRoot, realOutputRoot) ||
        isInside(realOutputRoot, checkoutRoot)
    ) {
        throw new Error(
            'Prepared source snapshot and checkout must be separate trees.'
        );
    }
    const record = inspectCleanGitSource(checkoutRoot, expected);
    const sourceSnapshot = copyWorkingTreeWithoutGitMetadata(
        checkoutRoot,
        realOutputRoot,
        expectedSourceSnapshotSha256
    );
    assertNoGitMetadata(realOutputRoot);
    return {
        ...record,
        sourceSnapshot,
    };
}

function parseArguments(argv) {
    const [command, ...tokens] = argv;
    const options = {};
    for (let index = 0; index < tokens.length; index += 2) {
        const name = tokens[index];
        const value = tokens[index + 1];
        if (!name?.startsWith('--') || value === undefined) {
            throw new Error(`Invalid command-line argument: ${name ?? ''}`);
        }
        options[name.slice(2)] = value;
    }
    return { command, options };
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
    const { command, options } = parseArguments(argv);
    if (
        command === 'prepare' &&
        options['runtime-manifest'] &&
        options.checkout &&
        options.output &&
        options['record-output']
    ) {
        const runtimeManifest = readJson(options['runtime-manifest']);
        const sourcePackage = runtimeManifest?.packages?.libplacebo;
        const record = prepareLinuxRuntimeSourceSnapshot({
            checkoutPath: options.checkout,
            outputPath: options.output,
            expected: {
                sourceGitCommit: sourcePackage?.sourceGitCommit,
                sourceSubmodules: sourcePackage?.sourceSubmodules,
            },
            expectedSourceSnapshotSha256:
                EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SNAPSHOT_SHA256,
        });
        writeJson(options['record-output'], record);
        return;
    }
    if (command === 'assert-vcs-free' && options.directory) {
        assertNoGitMetadata(options.directory);
        return;
    }
    throw new Error(
        'Usage: prepare-linux-runtime-source-snapshot.cjs prepare --runtime-manifest <path> --checkout <path> --output <path> --record-output <path> | assert-vcs-free --directory <path>'
    );
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = {
    EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SNAPSHOT_SHA256,
    LINUX_RUNTIME_SOURCE_SNAPSHOT_CONTRACT,
    assertNoGitMetadata,
    inspectCleanGitSource,
    inventoryLinuxRuntimeSourceSnapshot,
    prepareLinuxRuntimeSourceSnapshot,
    validateLinuxRuntimeSourceSnapshot,
};
