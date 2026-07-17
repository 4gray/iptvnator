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

    assert.deepEqual(firstRecord, expected);
    assert.deepEqual(secondRecord, expected);
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

    assert.deepEqual(
        helper.prepareLinuxRuntimeSourceSnapshot({
            checkoutPath: checkout,
            outputPath: output,
            expected,
        }),
        expected
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
