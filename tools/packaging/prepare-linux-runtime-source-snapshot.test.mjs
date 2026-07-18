import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const helperPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'prepare-linux-runtime-source-snapshot.cjs'
);

async function loadHelper() {
    if (!fs.existsSync(helperPath)) {
        return null;
    }
    return import(pathToFileURL(helperPath).href);
}

function runGit(cwd, args, env = {}) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
            ...process.env,
            ...env,
        },
    });
    assert.equal(
        result.status,
        0,
        `git ${args.join(' ')} failed:\n${result.stderr}`
    );
    return result.stdout.trim();
}

function createEquivalentCheckouts(root) {
    const origin = path.join(root, 'origin');
    fs.mkdirSync(origin);
    runGit(origin, ['init', '--quiet']);
    fs.mkdirSync(path.join(origin, 'src'));
    fs.writeFileSync(path.join(origin, 'src', 'renderer.c'), 'int main() {}\n');
    fs.writeFileSync(path.join(origin, 'LICENSE'), 'license\n');
    fs.symlinkSync('../LICENSE', path.join(origin, 'src', 'license-link'));
    runGit(origin, ['add', '.']);
    runGit(origin, ['commit', '--quiet', '-m', 'source fixture'], {
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
    });
    const commit = runGit(origin, ['rev-parse', 'HEAD']);
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    runGit(root, ['clone', '--quiet', origin, first]);
    runGit(root, ['clone', '--quiet', origin, second]);

    fs.appendFileSync(
        path.join(first, '.git', 'config'),
        '\n[fixture]\n\tvalue = first\n'
    );
    fs.appendFileSync(
        path.join(second, '.git', 'config'),
        '\n[fixture]\n\tvalue = second\n'
    );
    fs.writeFileSync(path.join(first, '.git', 'fixture-cache'), 'one');
    fs.writeFileSync(path.join(second, '.git', 'fixture-cache'), 'two');
    const differentTime = new Date('2030-01-01T00:00:00Z');
    fs.utimesSync(
        path.join(second, '.git', 'index'),
        differentTime,
        differentTime
    );

    return { commit, first, second };
}

function createCheckoutWithSubmodule(root) {
    const submoduleOrigin = path.join(root, 'submodule-origin');
    fs.mkdirSync(submoduleOrigin);
    runGit(submoduleOrigin, ['init', '--quiet']);
    fs.writeFileSync(
        path.join(submoduleOrigin, 'submodule-source.c'),
        'int submodule_source;\n'
    );
    runGit(submoduleOrigin, ['add', '.']);
    runGit(submoduleOrigin, ['commit', '--quiet', '-m', 'submodule source'], {
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
    });

    const checkout = path.join(root, 'checkout-with-submodule');
    fs.mkdirSync(checkout);
    runGit(checkout, ['init', '--quiet']);
    fs.writeFileSync(path.join(checkout, 'README'), 'source tree\n');
    runGit(checkout, ['add', 'README']);
    runGit(checkout, [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        '--quiet',
        submoduleOrigin,
        '3rdparty/example',
    ]);
    runGit(checkout, ['commit', '--quiet', '-m', 'source with submodule'], {
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_AUTHOR_DATE: '2000-01-02T00:00:00Z',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_DATE: '2000-01-02T00:00:00Z',
    });
    return {
        checkout,
        expected: {
            sourceGitCommit: runGit(checkout, ['rev-parse', 'HEAD']),
            sourceSubmodules: runGit(checkout, [
                'submodule',
                'status',
                '--recursive',
            ])
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean),
        },
    };
}

function snapshotRecords(root) {
    const records = [];
    function visit(directory, relativeDirectory = '') {
        for (const entry of fs
            .readdirSync(directory, { withFileTypes: true })
            .sort(({ name: left }, { name: right }) =>
                left.localeCompare(right)
            )) {
            const relativePath = path.posix.join(relativeDirectory, entry.name);
            const absolutePath = path.join(directory, entry.name);
            const stat = fs.lstatSync(absolutePath);
            if (entry.isDirectory()) {
                records.push({
                    path: `${relativePath}/`,
                    mode: stat.mode & 0o777,
                });
                visit(absolutePath, relativePath);
            } else if (entry.isSymbolicLink()) {
                records.push({
                    path: relativePath,
                    mode: stat.mode & 0o777,
                    symlink: fs.readlinkSync(absolutePath),
                });
            } else {
                records.push({
                    path: relativePath,
                    mode: stat.mode & 0o777,
                    sha256: crypto
                        .createHash('sha256')
                        .update(fs.readFileSync(absolutePath))
                        .digest('hex'),
                });
            }
        }
    }
    visit(root);
    return records;
}

const FIXTURE_SOURCE_SNAPSHOT = Object.freeze({
    schemaVersion: 1,
    sha256: '445a78c08a661d68f8ab15a790ba9c3462766d23e31b00eeca7429544c21a497',
    entryCount: 4,
    totalBytes: 22,
    entries: [
        {
            path: 'LICENSE',
            type: 'file',
            size: 8,
            executable: false,
            sha256: 'c0c56958ef8be5c1979366896b7e0c7206949a5aa2b23f51429c7f56b10990d3',
        },
        {
            path: 'src',
            type: 'directory',
        },
        {
            path: 'src/license-link',
            type: 'symlink',
            target: '../LICENSE',
        },
        {
            path: 'src/renderer.c',
            type: 'file',
            size: 14,
            executable: false,
            sha256: 'bc8bb8e433bf65214540115414c821c904b2a30d60a3ac0424bf9b77a00024b7',
        },
    ],
});

function cloneFixtureSourceSnapshot() {
    return JSON.parse(JSON.stringify(FIXTURE_SOURCE_SNAPSHOT));
}

test('purely validates the exact source snapshot contract independent of object key order', async () => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const shuffled = {
        entries: FIXTURE_SOURCE_SNAPSHOT.entries.map((entry) => {
            if (entry.type === 'file') {
                return {
                    sha256: entry.sha256,
                    executable: entry.executable,
                    size: entry.size,
                    type: entry.type,
                    path: entry.path,
                };
            }
            if (entry.type === 'symlink') {
                return {
                    target: entry.target,
                    type: entry.type,
                    path: entry.path,
                };
            }
            return {
                type: entry.type,
                path: entry.path,
            };
        }),
        totalBytes: FIXTURE_SOURCE_SNAPSHOT.totalBytes,
        entryCount: FIXTURE_SOURCE_SNAPSHOT.entryCount,
        sha256: FIXTURE_SOURCE_SNAPSHOT.sha256,
        schemaVersion: FIXTURE_SOURCE_SNAPSHOT.schemaVersion,
    };

    assert.deepEqual(
        helper.validateLinuxRuntimeSourceSnapshot(shuffled),
        FIXTURE_SOURCE_SNAPSHOT
    );
    assert.deepEqual(
        helper.validateLinuxRuntimeSourceSnapshot(shuffled, {
            expectedSha256: FIXTURE_SOURCE_SNAPSHOT.sha256,
        }),
        FIXTURE_SOURCE_SNAPSHOT
    );
    assert.deepEqual(shuffled.entries[0], {
        sha256: FIXTURE_SOURCE_SNAPSHOT.entries[0].sha256,
        executable: false,
        size: 8,
        type: 'file',
        path: 'LICENSE',
    });
});

test('rejects non-exact source snapshot fields and malformed entry shapes', async () => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const invalidSnapshots = [];

    const extraTopLevelField = cloneFixtureSourceSnapshot();
    extraTopLevelField.extra = true;
    invalidSnapshots.push(extraTopLevelField);

    const missingTopLevelField = cloneFixtureSourceSnapshot();
    delete missingTopLevelField.totalBytes;
    invalidSnapshots.push(missingTopLevelField);

    const extraEntryField = cloneFixtureSourceSnapshot();
    extraEntryField.entries[0].mode = 0o644;
    invalidSnapshots.push(extraEntryField);

    const missingEntryField = cloneFixtureSourceSnapshot();
    delete missingEntryField.entries[0].executable;
    invalidSnapshots.push(missingEntryField);

    const invalidFileSize = cloneFixtureSourceSnapshot();
    invalidFileSize.entries[0].size = -1;
    invalidSnapshots.push(invalidFileSize);

    const invalidExecutable = cloneFixtureSourceSnapshot();
    invalidExecutable.entries[0].executable = 1;
    invalidSnapshots.push(invalidExecutable);

    const invalidFileHash = cloneFixtureSourceSnapshot();
    invalidFileHash.entries[0].sha256 = 'A'.repeat(64);
    invalidSnapshots.push(invalidFileHash);

    const invalidType = cloneFixtureSourceSnapshot();
    invalidType.entries[1].type = 'socket';
    invalidSnapshots.push(invalidType);

    for (const snapshot of invalidSnapshots) {
        assert.throws(
            () => helper.validateLinuxRuntimeSourceSnapshot(snapshot),
            /invalid source snapshot/i
        );
    }
});

test('rejects unsafe or unsorted paths, bad links, aggregates, and digests', async () => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');

    const unsorted = cloneFixtureSourceSnapshot();
    [unsorted.entries[0], unsorted.entries[1]] = [
        unsorted.entries[1],
        unsorted.entries[0],
    ];
    assert.throws(
        () => helper.validateLinuxRuntimeSourceSnapshot(unsorted),
        /sorted and unique/i
    );

    const duplicate = cloneFixtureSourceSnapshot();
    duplicate.entries[1].path = duplicate.entries[0].path;
    assert.throws(
        () => helper.validateLinuxRuntimeSourceSnapshot(duplicate),
        /sorted and unique/i
    );

    const unsafePath = cloneFixtureSourceSnapshot();
    unsafePath.entries[0].path = '../LICENSE';
    assert.throws(
        () => helper.validateLinuxRuntimeSourceSnapshot(unsafePath),
        /unsafe source snapshot path/i
    );

    const unsafeLink = cloneFixtureSourceSnapshot();
    unsafeLink.entries[2].target = '../../outside';
    assert.throws(
        () => helper.validateLinuxRuntimeSourceSnapshot(unsafeLink),
        /unsafe source snapshot symlink/i
    );

    const missingParentDirectory = cloneFixtureSourceSnapshot();
    missingParentDirectory.entries.splice(1, 1);
    missingParentDirectory.entryCount -= 1;
    assert.throws(
        () => helper.validateLinuxRuntimeSourceSnapshot(missingParentDirectory),
        /parent.*directory/i
    );

    for (const [field, value] of [
        ['entryCount', FIXTURE_SOURCE_SNAPSHOT.entryCount + 1],
        ['totalBytes', FIXTURE_SOURCE_SNAPSHOT.totalBytes + 1],
        ['sha256', '0'.repeat(64)],
    ]) {
        const invalidAggregate = cloneFixtureSourceSnapshot();
        invalidAggregate[field] = value;
        assert.throws(
            () => helper.validateLinuxRuntimeSourceSnapshot(invalidAggregate),
            /invalid source snapshot/i
        );
    }

    assert.throws(
        () =>
            helper.validateLinuxRuntimeSourceSnapshot(FIXTURE_SOURCE_SNAPSHOT, {
                expectedSha256: '0'.repeat(64),
            }),
        /source snapshot digest mismatch/i
    );
});

test('prepares identical VCS-free snapshots from equivalent clean checkouts', async (t) => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-snapshot-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { commit, first, second } = createEquivalentCheckouts(root);
    const firstOutput = path.join(root, 'snapshot-first');
    const secondOutput = path.join(root, 'snapshot-second');
    const expected = {
        sourceGitCommit: commit,
        sourceSubmodules: [],
    };

    const firstRecord = helper.prepareLinuxRuntimeSourceSnapshot({
        checkoutPath: first,
        outputPath: firstOutput,
        expected,
    });
    const secondRecord = helper.prepareLinuxRuntimeSourceSnapshot({
        checkoutPath: second,
        outputPath: secondOutput,
        expected,
    });

    assert.deepEqual(firstRecord, {
        ...expected,
        sourceSnapshot: FIXTURE_SOURCE_SNAPSHOT,
    });
    assert.deepEqual(secondRecord, {
        ...expected,
        sourceSnapshot: FIXTURE_SOURCE_SNAPSHOT,
    });
    assert.deepEqual(
        helper.LINUX_RUNTIME_SOURCE_SNAPSHOT_CONTRACT,
        Object.freeze({
            schemaVersion: 1,
            hashAlgorithm: 'sha256',
            canonicalEncoding: 'utf8-json-line-v1',
        })
    );
    assert.deepEqual(
        helper.inventoryLinuxRuntimeSourceSnapshot(firstOutput),
        FIXTURE_SOURCE_SNAPSHOT
    );
    assert.deepEqual(
        snapshotRecords(firstOutput),
        snapshotRecords(secondOutput)
    );
    assert.equal(
        snapshotRecords(firstOutput).some(({ path: recordPath }) =>
            recordPath.split('/').includes('.git')
        ),
        false
    );
    assert.equal(
        fs.readlinkSync(path.join(firstOutput, 'src', 'license-link')),
        '../LICENSE'
    );
});

test('normalizes regular-file executable permissions in the canonical inventory', async (t) => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-modes-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    fs.mkdirSync(path.join(first, 'bin'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(second, 'bin'), { recursive: true, mode: 0o755 });
    fs.writeFileSync(path.join(first, 'bin', 'tool'), '#!/bin/sh\n', {
        mode: 0o700,
    });
    fs.writeFileSync(path.join(second, 'bin', 'tool'), '#!/bin/sh\n', {
        mode: 0o755,
    });
    fs.writeFileSync(path.join(first, 'README'), 'same\n', { mode: 0o600 });
    fs.writeFileSync(path.join(second, 'README'), 'same\n', { mode: 0o644 });

    const firstInventory = helper.inventoryLinuxRuntimeSourceSnapshot(first);
    const secondInventory = helper.inventoryLinuxRuntimeSourceSnapshot(second);

    assert.deepEqual(firstInventory, secondInventory);
    assert.deepEqual(
        firstInventory.entries.map((entry) => ({
            path: entry.path,
            executable: entry.executable,
        })),
        [
            { path: 'README', executable: false },
            { path: 'bin', executable: undefined },
            { path: 'bin/tool', executable: true },
        ]
    );
});

test('globally sorts prefix-colliding sibling paths before hashing', async (t) => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-global-order-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'c'));
    fs.mkdirSync(path.join(root, 'c++'));
    fs.writeFileSync(path.join(root, 'c', 'tool'), 'c\n');
    fs.writeFileSync(path.join(root, 'c++', 'tool'), 'c++\n');

    const inventory = helper.inventoryLinuxRuntimeSourceSnapshot(root);

    assert.deepEqual(
        inventory.entries.map(({ path: entryPath }) => entryPath),
        ['c', 'c++', 'c++/tool', 'c/tool']
    );
    assert.doesNotThrow(() =>
        helper.validateLinuxRuntimeSourceSnapshot(inventory)
    );
});

test('fails closed on VCS entries, unsafe symlinks, and special files', async (t) => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-unsafe-entry-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const vcsRoot = path.join(root, 'vcs');
    fs.mkdirSync(vcsRoot);
    fs.writeFileSync(path.join(vcsRoot, '.git'), 'gitdir: elsewhere\n');
    assert.throws(
        () => helper.inventoryLinuxRuntimeSourceSnapshot(vcsRoot),
        /must not contain VCS metadata.*\.git/i
    );

    const escapingLinkRoot = path.join(root, 'escaping-link');
    fs.mkdirSync(path.join(escapingLinkRoot, 'nested'), { recursive: true });
    fs.symlinkSync(
        '../../outside',
        path.join(escapingLinkRoot, 'nested', 'link')
    );
    assert.throws(
        () => helper.inventoryLinuxRuntimeSourceSnapshot(escapingLinkRoot),
        /unsafe source snapshot symlink.*nested\/link.*\.\.\/\.\.\/outside/i
    );

    const absoluteLinkRoot = path.join(root, 'absolute-link');
    fs.mkdirSync(absoluteLinkRoot);
    fs.symlinkSync('/outside', path.join(absoluteLinkRoot, 'link'));
    assert.throws(
        () => helper.inventoryLinuxRuntimeSourceSnapshot(absoluteLinkRoot),
        /unsafe source snapshot symlink.*\/outside/i
    );

    if (process.platform !== 'win32') {
        const specialRoot = path.join(root, 'special');
        fs.mkdirSync(specialRoot);
        const fifoPath = path.join(specialRoot, 'pipe');
        const mkfifo = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
        assert.equal(mkfifo.status, 0, mkfifo.stderr);
        assert.throws(
            () => helper.inventoryLinuxRuntimeSourceSnapshot(specialRoot),
            /unsupported source snapshot entry.*pipe/i
        );
    }
});

test('checks an optional expected digest atomically for direct callers', async (t) => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-expected-digest-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { commit, first } = createEquivalentCheckouts(root);
    const expected = {
        sourceGitCommit: commit,
        sourceSubmodules: [],
    };
    const matchingOutput = path.join(root, 'matching');

    assert.deepEqual(
        helper.prepareLinuxRuntimeSourceSnapshot({
            checkoutPath: first,
            outputPath: matchingOutput,
            expected,
            expectedSourceSnapshotSha256: FIXTURE_SOURCE_SNAPSHOT.sha256,
        }).sourceSnapshot,
        FIXTURE_SOURCE_SNAPSHOT
    );

    const mismatchingOutput = path.join(root, 'mismatching');
    assert.throws(
        () =>
            helper.prepareLinuxRuntimeSourceSnapshot({
                checkoutPath: first,
                outputPath: mismatchingOutput,
                expected,
                expectedSourceSnapshotSha256: '0'.repeat(64),
            }),
        /source snapshot digest mismatch.*expected 000000.*received 445a78/i
    );
    assert.equal(fs.existsSync(mismatchingOutput), false);
});

test('production CLI always enforces the trusted pinned libplacebo digest', async (t) => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    assert.match(
        helper.EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SNAPSHOT_SHA256,
        /^[a-f0-9]{64}$/
    );
    assert.equal(
        helper.EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SNAPSHOT_SHA256,
        '0db67c1523411255244186af437e9fbfe7ccac04a5ac1b3dc9275dd0806f6f0c'
    );
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-cli-digest-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { commit, first } = createEquivalentCheckouts(root);
    const runtimeManifestPath = path.join(root, 'runtime-manifest.json');
    fs.writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
            packages: {
                libplacebo: {
                    sourceGitCommit: commit,
                    sourceSubmodules: [],
                },
            },
        })
    );
    const outputPath = path.join(root, 'output');
    const recordOutputPath = path.join(root, 'record.json');
    const result = spawnSync(
        process.execPath,
        [
            helperPath,
            'prepare',
            '--runtime-manifest',
            runtimeManifestPath,
            '--checkout',
            first,
            '--output',
            outputPath,
            '--record-output',
            recordOutputPath,
        ],
        { encoding: 'utf8' }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /source snapshot digest mismatch/i);
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(fs.existsSync(recordOutputPath), false);
});

test('validates checkout cleanliness and exact commit/submodule identities before copying', async (t) => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-identity-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { commit, first, second } = createEquivalentCheckouts(root);

    assert.throws(
        () =>
            helper.prepareLinuxRuntimeSourceSnapshot({
                checkoutPath: first,
                outputPath: path.join(root, 'wrong-commit'),
                expected: {
                    sourceGitCommit: '0'.repeat(40),
                    sourceSubmodules: [],
                },
            }),
        /commit does not match/
    );
    assert.throws(
        () =>
            helper.prepareLinuxRuntimeSourceSnapshot({
                checkoutPath: first,
                outputPath: path.join(root, 'wrong-submodules'),
                expected: {
                    sourceGitCommit: commit,
                    sourceSubmodules: [`${'1'.repeat(40)} 3rdparty/example`],
                },
            }),
        /submodules do not match/
    );

    fs.writeFileSync(path.join(second, 'untracked-build-output'), 'dirty');
    assert.throws(
        () =>
            helper.prepareLinuxRuntimeSourceSnapshot({
                checkoutPath: second,
                outputPath: path.join(root, 'dirty'),
                expected: {
                    sourceGitCommit: commit,
                    sourceSubmodules: [],
                },
            }),
        /dirty or untracked files/
    );

    const existingOutput = path.join(root, 'existing-output');
    fs.mkdirSync(existingOutput);
    fs.writeFileSync(
        path.join(existingOutput, 'owned-by-someone-else'),
        'keep'
    );
    assert.throws(
        () =>
            helper.prepareLinuxRuntimeSourceSnapshot({
                checkoutPath: first,
                outputPath: existingOutput,
                expected: {
                    sourceGitCommit: commit,
                    sourceSubmodules: [],
                },
            }),
        /output.*must not already exist/i
    );
    assert.equal(
        fs.readFileSync(
            path.join(existingOutput, 'owned-by-someone-else'),
            'utf8'
        ),
        'keep'
    );

    const existingSymlink = path.join(root, 'existing-symlink');
    fs.symlinkSync('missing-target', existingSymlink);
    assert.throws(
        () =>
            helper.prepareLinuxRuntimeSourceSnapshot({
                checkoutPath: first,
                outputPath: existingSymlink,
                expected: {
                    sourceGitCommit: commit,
                    sourceSubmodules: [],
                },
            }),
        /output.*must not already exist/i
    );
    assert.equal(fs.readlinkSync(existingSymlink), 'missing-target');
});

test('preserves recursive submodule sources while stripping every nested .git link', async (t) => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-submodule-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { checkout, expected } = createCheckoutWithSubmodule(root);
    const output = path.join(root, 'submodule-snapshot');

    const record = helper.prepareLinuxRuntimeSourceSnapshot({
        checkoutPath: checkout,
        outputPath: output,
        expected,
    });
    assert.deepEqual(
        {
            sourceGitCommit: record.sourceGitCommit,
            sourceSubmodules: record.sourceSubmodules,
        },
        expected
    );
    assert.deepEqual(
        record.sourceSnapshot,
        helper.inventoryLinuxRuntimeSourceSnapshot(output)
    );
    assert.equal(
        fs.readFileSync(
            path.join(output, '3rdparty', 'example', 'submodule-source.c'),
            'utf8'
        ),
        'int submodule_source;\n'
    );
    assert.doesNotThrow(() => helper.assertNoGitMetadata(output));
});

test('fails closed when a prepared snapshot contains any nested .git entry', async (t) => {
    const helper = await loadHelper();
    assert.ok(helper, 'the deterministic source snapshot helper must exist');
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-vcs-entry-')
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'nested', '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, 'nested', '.git', 'index'), 'metadata');

    assert.throws(
        () => helper.assertNoGitMetadata(root),
        /must not contain VCS metadata.*nested\/\.git/i
    );
});
