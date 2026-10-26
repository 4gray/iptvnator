import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, '..', '..');
const modulePath = path.join(currentDir, 'macos-source-patches.mjs');
const { MACOS_SOURCE_PATCHES, applySourcePatches } = await import(
    pathToFileURL(modulePath)
);

const ORIGINAL = 'one\ntwo\n';
const PATCHED = 'one\nTWO\n';
const TWO_TO_UPPER = [
    'diff --git a/audio/f.c b/audio/f.c',
    '--- a/audio/f.c',
    '+++ b/audio/f.c',
    '@@ -1,2 +1,2 @@',
    ' one',
    '-two',
    '+TWO',
    '',
].join('\n');
const THREE_TO_UPPER = TWO_TO_UPPER.replaceAll('two', 'three').replaceAll(
    'TWO',
    'THREE'
);

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function withFixture(sourceText, run) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-source-patches-test-')
    );
    try {
        const sourcePath = path.join(root, 'source');
        fs.mkdirSync(path.join(sourcePath, 'audio'), { recursive: true });
        fs.writeFileSync(path.join(sourcePath, 'audio', 'f.c'), sourceText);
        const readSource = () =>
            fs.readFileSync(path.join(sourcePath, 'audio', 'f.c'), 'utf8');
        const addPatch = (name, text, overrides = {}) => {
            fs.mkdirSync(path.join(root, 'patches'), { recursive: true });
            fs.writeFileSync(path.join(root, 'patches', name), text);
            return {
                packageId: 'mpv',
                path: `patches/${name}`,
                sha256: sha256(text),
                upstreamCommit: 'a'.repeat(40),
                upstreamPullRequest: 'https://example.invalid/pull/1',
                ...overrides,
            };
        };
        return run({ root, sourcePath, readSource, addPatch });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('pins every mpv patch by SHA-256 and upstream commit', () => {
    const mpvPatches = MACOS_SOURCE_PATCHES.filter(
        (patch) => patch.packageId === 'mpv'
    );
    assert.equal(mpvPatches.length, 2);
    for (const patch of mpvPatches) {
        const patchPath = path.join(workspaceRoot, patch.path);
        assert.equal(fs.existsSync(patchPath), true, patch.path);
        const bytes = fs.readFileSync(patchPath);
        assert.equal(sha256(bytes), patch.sha256, patch.path);
        assert.match(patch.upstreamCommit, /^[0-9a-f]{40}$/);
        assert.equal(
            bytes.toString('utf8').split('\n')[0],
            `From ${patch.upstreamCommit} Mon Sep 17 00:00:00 2001`
        );
    }
});

test('limits every mpv patch to ao_coreaudio.c', () => {
    for (const patch of MACOS_SOURCE_PATCHES) {
        const text = fs.readFileSync(
            path.join(workspaceRoot, patch.path),
            'utf8'
        );
        const diffLines = text
            .split('\n')
            .filter((line) => line.startsWith('diff --git '));
        assert.deepEqual(diffLines, [
            'diff --git a/audio/out/ao_coreaudio.c b/audio/out/ao_coreaudio.c',
        ]);
    }
});

test('applies a patch and returns its record', () => {
    withFixture(ORIGINAL, ({ root, sourcePath, readSource, addPatch }) => {
        const patch = addPatch('0001-upper.patch', TWO_TO_UPPER);
        const applied = applySourcePatches({
            packageId: 'mpv',
            sourcePath,
            workspaceRoot: root,
            patches: [patch],
        });
        assert.equal(readSource(), PATCHED);
        assert.deepEqual(applied, [
            {
                name: '0001-upper.patch',
                sha256: patch.sha256,
                upstreamCommit: patch.upstreamCommit,
                upstreamPullRequest: patch.upstreamPullRequest,
            },
        ]);
    });
});

test('skips patches for other packages', () => {
    withFixture(ORIGINAL, ({ root, sourcePath, readSource, addPatch }) => {
        const patch = addPatch('0001-upper.patch', TWO_TO_UPPER);
        const applied = applySourcePatches({
            packageId: 'ffmpeg',
            sourcePath,
            workspaceRoot: root,
            patches: [patch],
        });
        assert.deepEqual(applied, []);
        assert.equal(readSource(), ORIGINAL);
    });
});

test('rejects a patch whose bytes changed', () => {
    withFixture(ORIGINAL, ({ root, sourcePath, readSource, addPatch }) => {
        const patch = addPatch('0001-upper.patch', TWO_TO_UPPER, {
            sha256: '0'.repeat(64),
        });
        assert.throws(
            () =>
                applySourcePatches({
                    packageId: 'mpv',
                    sourcePath,
                    workspaceRoot: root,
                    patches: [patch],
                }),
            (error) =>
                error.message.includes('0001-upper.patch') &&
                error.message.includes('expected') &&
                error.message.includes('actual')
        );
        assert.equal(readSource(), ORIGINAL);
    });
});

test('rejects a patch that is already applied', () => {
    withFixture(PATCHED, ({ root, sourcePath, readSource, addPatch }) => {
        const patch = addPatch('0001-upper.patch', TWO_TO_UPPER);
        assert.throws(
            () =>
                applySourcePatches({
                    packageId: 'mpv',
                    sourcePath,
                    workspaceRoot: root,
                    patches: [patch],
                }),
            (error) =>
                error.message.includes('already applied') &&
                error.message.includes('remove')
        );
        assert.equal(readSource(), PATCHED);
    });
});

test('rejects a patch that does not apply', () => {
    withFixture(
        'one\nthree\n',
        ({ root, sourcePath, readSource, addPatch }) => {
            const patch = addPatch('0001-upper.patch', TWO_TO_UPPER);
            assert.throws(
                () =>
                    applySourcePatches({
                        packageId: 'mpv',
                        sourcePath,
                        workspaceRoot: root,
                        patches: [patch],
                    }),
                (error) =>
                    error.message.includes('0001-upper.patch') &&
                    error.message.includes('does not apply')
            );
            assert.equal(readSource(), 'one\nthree\n');
        }
    );
});

test('names the failing patch when a later patch fails', () => {
    withFixture(ORIGINAL, ({ root, sourcePath, addPatch }) => {
        const first = addPatch('0001-upper.patch', TWO_TO_UPPER);
        const second = addPatch('0002-three.patch', THREE_TO_UPPER);
        assert.throws(
            () =>
                applySourcePatches({
                    packageId: 'mpv',
                    sourcePath,
                    workspaceRoot: root,
                    patches: [first, second],
                }),
            (error) =>
                error.message.includes('0002-three.patch') &&
                !error.message.includes('0001-upper.patch')
        );
    });
});

test('rejects a patch that did not land', () => {
    withFixture(ORIGINAL, ({ root, sourcePath, addPatch }) => {
        const patch = addPatch('0001-upper.patch', TWO_TO_UPPER);
        const calls = [];
        // Every git call succeeds except the reverse checks: the first one
        // (already applied?) must fail to proceed, and the final one fails
        // because the stubbed apply changed nothing.
        const runGit = (args) => {
            calls.push(args);
            const isReverseCheck = args.includes('--reverse');
            return { status: isReverseCheck ? 1 : 0, stderr: '' };
        };
        assert.throws(
            () =>
                applySourcePatches({
                    packageId: 'mpv',
                    sourcePath,
                    workspaceRoot: root,
                    patches: [patch],
                    runGit,
                }),
            (error) =>
                error.message.includes('0001-upper.patch') &&
                error.message.includes('did not land')
        );
        assert.equal(calls.length, 3);
    });
});

const macosBuilderSource = fs.readFileSync(
    path.join(currentDir, 'build-macos-runtime.mjs'),
    'utf8'
);

test('applies mpv patches between download and build', () => {
    assert.match(
        macosBuilderSource,
        /import \{ applySourcePatches \} from '\.\/macos-source-patches\.mjs';/
    );
    const mainBlock = macosBuilderSource.slice(
        macosBuilderSource.lastIndexOf('try {')
    );
    const downloadIndex = mainBlock.indexOf('downloadSources();');
    const patchIndex = mainBlock.indexOf('applySourcePatches(');
    const buildIndex = mainBlock.indexOf('buildRuntime();');
    assert.ok(downloadIndex >= 0, 'downloadSources() runs in main block');
    assert.ok(patchIndex > downloadIndex, 'patches follow the download');
    assert.ok(buildIndex > patchIndex, 'the build follows the patches');
});

test('records applied patches in the mpv manifest block', () => {
    const writeManifest = macosBuilderSource.slice(
        macosBuilderSource.indexOf('function writeManifest()')
    );
    const mpvBlock = writeManifest.slice(
        writeManifest.indexOf('mpv: {'),
        writeManifest.indexOf('sourceDistribution:')
    );
    assert.match(mpvBlock, /localPatches: appliedMpvPatches/);
});
