import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import {
    assertBuildSnapWorkflowPolicy,
    assertPublishSnapWorkflowPolicy,
} from './snap-workflow-policy.test-helpers.mjs';

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

function insertFirstJobStep(workflowText, stepSource) {
    const stepsHeader = /^([ \t]+)steps:\r?\n/m.exec(workflowText);
    assert.ok(stepsHeader, 'workflow must contain a steps list');
    const insertionIndex = stepsHeader.index + stepsHeader[0].length;
    const stepIndent = `${stepsHeader[1]}    `;
    const indentedStep = stepSource
        .split('\n')
        .map((line) => `${stepIndent}${line}`)
        .join('\n');
    return `${workflowText.slice(
        0,
        insertionIndex
    )}${indentedStep}\n${workflowText.slice(insertionIndex)}`;
}

function insertWorkflowJob(workflowText, jobSource) {
    const jobsHeader = /^([ \t]*)jobs:\r?\n/m.exec(workflowText);
    assert.ok(jobsHeader, 'workflow must contain a jobs mapping');
    const insertionIndex = jobsHeader.index + jobsHeader[0].length;
    const jobIndent = `${jobsHeader[1]}    `;
    const indentedJob = jobSource
        .split('\n')
        .map((line) => `${jobIndent}${line}`)
        .join('\n');
    return `${workflowText.slice(
        0,
        insertionIndex
    )}${indentedJob}\n${workflowText.slice(insertionIndex)}`;
}

function insertFirstJobField(workflowText, fieldSource) {
    const stepsHeader = /^([ \t]+)steps:\r?\n/m.exec(workflowText);
    assert.ok(stepsHeader, 'workflow must contain a steps list');
    const fieldIndent = stepsHeader[1];
    const indentedField = fieldSource
        .split('\n')
        .map((line) => `${fieldIndent}${line}`)
        .join('\n');
    return `${workflowText.slice(
        0,
        stepsHeader.index
    )}${indentedField}\n${workflowText.slice(stepsHeader.index)}`;
}

function assertStepRejectedByBothPolicies(stepSource) {
    for (const [workflowPath, assertPolicy] of [
        [publishWorkflowPath, assertPublishSnapWorkflowPolicy],
        [buildWorkflowPath, assertBuildSnapWorkflowPolicy],
    ]) {
        const workflowText = insertFirstJobStep(
            fs.readFileSync(workflowPath, 'utf8'),
            stepSource
        );
        assert.doesNotThrow(() => parse(workflowText));
        assert.throws(() => assertPolicy(workflowText));
    }
}

test('publishes Snap only after a public v-tag release contains binary and source assets', () => {
    assert.equal(
        fs.existsSync(publishWorkflowPath),
        true,
        'the release-published Snap workflow must exist'
    );
    const workflowText = fs.readFileSync(publishWorkflowPath, 'utf8');
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
    assertPublishSnapWorkflowPolicy(workflowText);
    const disabledWorkflow = workflowText.replace(
        'github.event.release.draft == false }}',
        'github.event.release.draft == false && false }}'
    );
    assert.notEqual(disabledWorkflow, workflowText);
    assert.doesNotThrow(() => parse(disabledWorkflow));
    assert.throws(() => assertPublishSnapWorkflowPolicy(disabledWorkflow));
    const extraTrigger = workflowText.replace(
        '            - published',
        '            - published\n            - edited'
    );
    assert.doesNotThrow(() => parse(extraTrigger));
    assert.throws(() => assertPublishSnapWorkflowPolicy(extraTrigger));
    assert.match(
        workflowText,
        /Candidate\/stable promotion is manual after installed-Snap frame-copy and missing-runtime fallback smoke/
    );

    const buildWorkflow = fs.readFileSync(buildWorkflowPath, 'utf8');
    assert.doesNotMatch(buildWorkflow, /^ {4}publish-snap:/m);
    assertBuildSnapWorkflowPolicy(buildWorkflow);
});

test('isolates released verification from the fresh credentialed upload runner', () => {
    const workflowText = fs.readFileSync(publishWorkflowPath, 'utf8');
    const workflow = parse(workflowText);
    assert.deepEqual(Object.keys(workflow.jobs), [
        'verify-snap',
        'publish-snap',
    ]);

    const verifyJob = workflow.jobs['verify-snap'];
    const publishJob = workflow.jobs['publish-snap'];
    assert.equal(publishJob.needs, 'verify-snap');
    assert.deepEqual(verifyJob.outputs, {
        'receipt-sha256': '${{ steps.bind-transfer.outputs.receipt-sha256 }}',
    });
    assert.equal(JSON.stringify(verifyJob).includes('snapcraft_token'), false);
    assert.deepEqual(
        verifyJob.steps.filter((step) => step.uses).map((step) => step.uses),
        [
            'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
            'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        ]
    );
    assert.deepEqual(
        publishJob.steps.filter((step) => step.uses).map((step) => step.uses),
        ['actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093']
    );

    const bindingStep = verifyJob.steps.find(
        (step) => step.name === 'Bind verified release transfer'
    );
    assert.equal(bindingStep.id, 'bind-transfer');
    assert.match(
        bindingStep.run,
        /\/usr\/bin\/sha256sum --binary[\s\S]*receipt-sha256/
    );
    const transferredSealStep = publishJob.steps.find(
        (step) => step.name === 'Seal transferred public release assets'
    );
    assert.deepEqual(transferredSealStep.env, {
        EXPECTED_RECEIPT_SHA256:
            '${{ needs.verify-snap.outputs.receipt-sha256 }}',
    });
    assert.match(
        transferredSealStep.run,
        /\/usr\/bin\/sha256sum --binary[\s\S]*EXPECTED_RECEIPT_SHA256/
    );
    assert.match(
        transferredSealStep.run,
        /\/usr\/bin\/jq --exit-status[\s\S]*\/usr\/bin\/sha256sum --strict --check/
    );
    assert.match(
        transferredSealStep.run,
        /\/usr\/bin\/jq --raw-output[\s\S]*@tsv[\s\S]*while IFS=\$'\\t' read -r ASSET_NAME EXPECTED_SIZE[\s\S]*\/usr\/bin\/stat --format=%s -- "\$\{ASSET_PATH\}"[\s\S]*test "\$\{ACTUAL_SIZE\}" = "\$\{EXPECTED_SIZE\}"/
    );

    const uploadJobCommands = publishJob.steps
        .map((step) => step.run ?? '')
        .join('\n');
    assert.doesNotMatch(uploadJobCommands, /\bnode\b/);
    assert.doesNotMatch(uploadJobCommands, /release-snap-assets\.cjs/);
    const uploadStep = publishJob.steps.at(-1);
    assert.deepEqual(uploadStep.env, {
        SNAPCRAFT_STORE_CREDENTIALS: '${{ secrets.snapcraft_token }}',
    });
    assert.match(uploadStep.run, /shopt -s nullglob dotglob/);
    assert.match(
        uploadStep.run,
        /SNAP_FILES=\("\$\{VERIFIED_ASSET_DIRECTORY\}"\/\*\.snap\)/
    );
    assert.match(
        uploadStep.run,
        /SNAPCRAFT_STORE_CREDENTIALS="\$\{STORE_CREDENTIALS\}" \/snap\/bin\/snapcraft upload --release=edge/
    );
    assert.doesNotMatch(uploadStep.run, /\bfind\b|\bsort\b|\bnode\b/);
    assertPublishSnapWorkflowPolicy(workflowText);
});

test('rejects environment and execution-surface expansion on the fresh publish runner', () => {
    const workflowText = fs.readFileSync(publishWorkflowPath, 'utf8');
    for (const mutatedWorkflow of [
        workflowText.replace(
            '    publish-snap:\n',
            '    publish-snap:\n        env:\n            BASH_ENV: /tmp/release-hook\n'
        ),
        workflowText.replace(
            '        runs-on: ubuntu-latest\n        timeout-minutes: 20',
            '        runs-on: ubuntu-latest\n        container: ubuntu:latest\n        timeout-minutes: 20'
        ),
        workflowText.replace(
            'permissions:\n    contents: read',
            'env:\n    BASH_ENV: /tmp/release-hook\n\npermissions:\n    contents: read'
        ),
        workflowText.replaceAll(
            'runs-on: ubuntu-latest',
            'runs-on: self-hosted'
        ),
        workflowText.replace(
            '        timeout-minutes: 20',
            '        timeout-minutes: 120'
        ),
    ]) {
        assert.notEqual(mutatedWorkflow, workflowText);
        assert.doesNotThrow(() => parse(mutatedWorkflow));
        assert.throws(() => assertPublishSnapWorkflowPolicy(mutatedWorkflow));
    }
});

test('rejects Snap uploads that target candidate or stable channels', () => {
    const workflowText = fs.readFileSync(publishWorkflowPath, 'utf8');
    for (const forbiddenReleaseArgument of [
        '--release=edge,candidate,stable',
        '--release edge,candidate,stable',
        '--release=candidate',
        '--release stable',
    ]) {
        const mixedChannelWorkflow = workflowText.replace(
            '--release=edge',
            forbiddenReleaseArgument
        );
        assert.notEqual(mixedChannelWorkflow, workflowText);
        assert.doesNotThrow(() => parse(mixedChannelWorkflow));
        assert.throws(() =>
            assertPublishSnapWorkflowPolicy(mixedChannelWorkflow)
        );
    }
});

test('rejects edge upload text in non-executing shell contexts', () => {
    const workflowText = fs.readFileSync(publishWorkflowPath, 'utf8');
    const edgeUpload =
        'SNAPCRAFT_STORE_CREDENTIALS="${STORE_CREDENTIALS}" /snap/bin/snapcraft upload --release=edge "${SNAP_FILE}"';
    const blockIndent = ' '.repeat(18);
    for (const replacement of [
        `cat <<123\n${edgeUpload}\n123`,
        `cat <<\\EOF\n${edgeUpload}\nEOF`,
        `printf '%s\\n' "\n${edgeUpload}\n"`,
        `publish_snap() {\n${edgeUpload}\n}`,
        `if false; then\n${edgeUpload}\nfi`,
        `cat <<FIRST <<SECOND\nfirst\nFIRST\n${edgeUpload}\nSECOND`,
        `cat <<-'EOF'\n\t${edgeUpload}\n\tEOF`,
        `cat <<'EOF'\n${edgeUpload}\nEOF`,
    ]) {
        const indentedReplacement = replacement.replaceAll(
            '\n',
            `\n${blockIndent}`
        );
        const mutatedWorkflow = workflowText.replace(
            edgeUpload,
            indentedReplacement
        );
        assert.notEqual(mutatedWorkflow, workflowText);
        assert.doesNotThrow(() => parse(mutatedWorkflow));
        assert.throws(() => assertPublishSnapWorkflowPolicy(mutatedWorkflow));
    }
});

test('rejects extra CLI tokens across wrappers, YAML forms, quotes, and heredocs', () => {
    const workflowText = fs.readFileSync(publishWorkflowPath, 'utf8');
    for (const stepSource of [
        '- run: command snapcraft upload --release=stable package.snap',
        '- run: |\n    if true; then command snapcraft \\\n        upload --release=edge,candidate,stable package.snap; fi',
        '- run: |\n    snap\\\n        craft upload --release=stable package.snap',
        '- run: |\n    snapcraft up\\\n        load --release=stable package.snap',
        '- run: |2\n    snapcraft upload --release=stable package.snap',
        '- run: snapcraft upload --release=stable package.snap',
        '- { run: snapcraft upload --release=stable package.snap }',
        '- run: echo "snapcraft upload --release=edge package.snap"',
        "- run: |\n    cat <<'EOF'\n    snapcraft upload --release=edge package.snap\n    EOF",
        '- run: command snapcraft release iptvnator stable',
    ]) {
        const mutatedWorkflow = insertFirstJobStep(workflowText, stepSource);
        assert.doesNotThrow(() => parse(mutatedWorkflow));
        assert.throws(() => assertPublishSnapWorkflowPolicy(mutatedWorkflow));
    }
});

test('rejects continued uploads and release commands in the build workflow', () => {
    const workflowText = fs.readFileSync(buildWorkflowPath, 'utf8');
    for (const stepSource of [
        '- run: |\n    if true; then command snapcraft \\\n        upload --release=edge package.snap; fi',
        '- run: command snapcraft release iptvnator edge',
    ]) {
        const mutatedWorkflow = insertFirstJobStep(workflowText, stepSource);
        assert.doesNotThrow(() => parse(mutatedWorkflow));
        assert.throws(() => assertBuildSnapWorkflowPolicy(mutatedWorkflow));
    }
});

test('rejects encoded, indirect, and unknown actions in both workflows', () => {
    for (const stepSource of [
        '- uses: snapcore/action-publish@v1\n  with:\n    release: stable',
        '- "uses": snapcore/action-publish@v1\n  with:\n    release: stable',
        "- 'uses' : snapcore/action-publish@v1\n  with:\n    release: stable",
        '- "\\x75ses": snapcore/action-publish@v1\n  with:\n    release: stable',
        '- ? uses\n  : snapcore/action-publish@v1\n  with:\n    release: stable',
        '- { uses: snapcore/action-publish@v1, with: { release: stable } }',
        '- uses: >-\n    snapcore/action-publish@v1\n  with:\n    release: stable',
        '- name: Alias publisher\n  env:\n    PUBLISHER: &publisher snapcore/action-publish@v1\n  uses: *publisher\n  with:\n    release: stable',
        '- uses: "\\x73napcore/action-publish@v1"\n  with:\n    release: stable',
        '- uses: example/action-publish@v1\n  with:\n    release: stable',
    ]) {
        assertStepRejectedByBothPolicies(stepSource);
    }
});

test('rejects job-level reusable workflow publication in both workflows', () => {
    const reusableJob =
        'synthetic-publisher:\n  uses: snapcore/action-publish/.github/workflows/publish.yml@v1\n  with:\n    release: stable\n  secrets: inherit';
    for (const [workflowPath, assertPolicy] of [
        [publishWorkflowPath, assertPublishSnapWorkflowPolicy],
        [buildWorkflowPath, assertBuildSnapWorkflowPolicy],
    ]) {
        const workflowText = insertWorkflowJob(
            fs.readFileSync(workflowPath, 'utf8'),
            reusableJob
        );
        assert.doesNotThrow(() => parse(workflowText));
        assert.throws(() => assertPolicy(workflowText));
    }
});

test('rejects command-bearing explicit shell templates in both workflows', () => {
    const maliciousShell = '"snapcraft release iptvnator stable; bash {0}"';
    for (const [workflowPath, assertPolicy] of [
        [publishWorkflowPath, assertPublishSnapWorkflowPolicy],
        [buildWorkflowPath, assertBuildSnapWorkflowPolicy],
    ]) {
        const workflowText = fs.readFileSync(workflowPath, 'utf8');
        for (const mutatedWorkflow of [
            insertFirstJobStep(
                workflowText,
                `- shell: ${maliciousShell}\n  run: echo safe`
            ),
            `${workflowText}\ndefaults:\n    run:\n        shell: ${maliciousShell}\n`,
            insertFirstJobField(
                workflowText,
                `defaults:\n    run:\n        shell: ${maliciousShell}`
            ),
        ]) {
            assert.doesNotThrow(() => parse(mutatedWorkflow));
            assert.throws(() => assertPolicy(mutatedWorkflow));
        }
    }
});

test('ignores Snapcraft names in comments and allowlisted action uses', () => {
    const commentStep =
        '- run: |\n    # snapcraft upload --release=stable package.snap\n    # snapcraft release iptvnator stable';
    const publishWorkflow = insertFirstJobStep(
        fs.readFileSync(publishWorkflowPath, 'utf8'),
        commentStep
    );
    const buildWorkflow = insertFirstJobStep(
        fs.readFileSync(buildWorkflowPath, 'utf8'),
        commentStep
    );

    assert.doesNotThrow(() => parse(publishWorkflow));
    assert.doesNotThrow(() => parse(buildWorkflow));
    assert.doesNotThrow(() => assertPublishSnapWorkflowPolicy(publishWorkflow));
    assert.doesNotThrow(() => assertBuildSnapWorkflowPolicy(buildWorkflow));
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
