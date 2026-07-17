import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
);
const buildWorkflowPath = path.join(
    workspaceRoot,
    '.github',
    'workflows',
    'build-and-make.yaml'
);
const publishWorkflowPath = path.join(
    workspaceRoot,
    '.github',
    'workflows',
    'publish-snap.yaml'
);
const releaseAssetHelperPath = path.join(
    workspaceRoot,
    'tools',
    'packaging',
    'release-snap-assets.cjs'
);

async function loadReleaseAssetHelper() {
    if (!fs.existsSync(releaseAssetHelperPath)) {
        return null;
    }
    return import(pathToFileURL(releaseAssetHelperPath).href);
}

test('publishes Snap only after a public v-tag release contains binary and source assets', () => {
    assert.equal(
        fs.existsSync(publishWorkflowPath),
        true,
        'the release-published Snap workflow must exist'
    );
    const workflowText = fs.readFileSync(publishWorkflowPath, 'utf8');
    assert.match(
        workflowText,
        /^on:\n {4}release:\n {8}types:\n {12}- published$/m
    );
    assert.match(workflowText, /^permissions:\n {4}contents: read$/m);
    assert.match(
        workflowText,
        /startsWith\(github\.event\.release\.tag_name,\s*'v'\)/
    );
    assert.match(workflowText, /github\.event\.release\.draft\s*==\s*false/);

    const validateIndex = workflowText.indexOf(
        '- name: Select exact public release assets'
    );
    const verifyIndex = workflowText.indexOf(
        '- name: Verify downloaded public release assets'
    );
    const uploadIndex = workflowText.indexOf(
        '- name: Publish all public-release snaps to edge'
    );
    assert.ok(validateIndex >= 0);
    assert.ok(verifyIndex > validateIndex);
    assert.ok(uploadIndex > verifyIndex);

    assert.match(
        workflowText,
        /github\.event\.release\.id[\s\S]*release-snap-assets\.cjs select/
    );
    assert.match(workflowText, /linux-frame-copy-runtime-sources\.tar\.xz/);
    assert.match(workflowText, /release-snap-assets\.cjs verify/);
    assert.match(workflowText, /snapcraft upload --release=edge/);

    const buildWorkflow = fs.readFileSync(buildWorkflowPath, 'utf8');
    assert.doesNotMatch(buildWorkflow, /^ {4}publish-snap:/m);
    assert.doesNotMatch(buildWorkflow, /snapcraft upload/);
});

test('selects every exact Snap and exactly one compliance source asset', async () => {
    const helper = await loadReleaseAssetHelper();
    assert.ok(helper, 'the release asset selection helper must exist');
    const selected = helper.selectSnapReleaseAssets([
        { id: 9, name: 'IPTVnator-1.0.0-amd64.snap' },
        { id: 3, name: 'linux-frame-copy-runtime-sources.tar.xz' },
        { id: 8, name: 'IPTVnator-1.0.0-armhf.snap' },
        { id: 7, name: 'IPTVnator-1.0.0.AppImage' },
    ]);

    assert.deepEqual(selected, {
        snapAssets: [
            { id: 9, name: 'IPTVnator-1.0.0-amd64.snap' },
            { id: 8, name: 'IPTVnator-1.0.0-armhf.snap' },
        ],
        sourceAsset: {
            id: 3,
            name: 'linux-frame-copy-runtime-sources.tar.xz',
        },
    });
});

test('rejects a release missing either exact asset class or containing ambiguous source assets', async () => {
    const helper = await loadReleaseAssetHelper();
    assert.ok(helper, 'the release asset selection helper must exist');
    assert.throws(
        () =>
            helper.selectSnapReleaseAssets([
                {
                    id: 1,
                    name: 'linux-frame-copy-runtime-sources.tar.xz',
                },
            ]),
        /at least one \.snap asset/
    );
    assert.throws(
        () =>
            helper.selectSnapReleaseAssets([{ id: 1, name: 'IPTVnator.snap' }]),
        /exactly one linux-frame-copy-runtime-sources\.tar\.xz/
    );
    assert.throws(
        () =>
            helper.selectSnapReleaseAssets([
                { id: 1, name: 'IPTVnator.snap' },
                {
                    id: 2,
                    name: 'linux-frame-copy-runtime-sources.tar.xz',
                },
                {
                    id: 3,
                    name: 'linux-frame-copy-runtime-sources.tar.xz',
                },
            ]),
        /exactly one linux-frame-copy-runtime-sources\.tar\.xz/
    );
});

test('verifies the complete selected download set before publication', async (t) => {
    const helper = await loadReleaseAssetHelper();
    assert.ok(helper, 'the release asset selection helper must exist');
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-snap-release-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const manifest = {
        snapAssets: [{ id: 1, name: 'IPTVnator.snap' }],
        sourceAsset: {
            id: 2,
            name: 'linux-frame-copy-runtime-sources.tar.xz',
        },
    };

    fs.writeFileSync(path.join(temporaryRoot, 'IPTVnator.snap'), 'snap');
    assert.throws(
        () => helper.verifySnapReleaseDownloads(manifest, temporaryRoot),
        /missing or empty.*linux-frame-copy-runtime-sources\.tar\.xz/i
    );
    fs.writeFileSync(
        path.join(temporaryRoot, 'linux-frame-copy-runtime-sources.tar.xz'),
        'sources'
    );
    assert.deepEqual(
        helper.verifySnapReleaseDownloads(manifest, temporaryRoot),
        manifest
    );
});
