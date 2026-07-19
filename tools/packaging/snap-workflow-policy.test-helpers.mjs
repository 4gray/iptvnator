import assert from 'node:assert/strict';
import { parse } from 'yaml';

const PINNED_CHECKOUT_ACTION =
    'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5';
const PINNED_UPLOAD_ARTIFACT_ACTION =
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';
const PINNED_DOWNLOAD_ARTIFACT_ACTION =
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093';
const PUBLISH_ACTION_ALLOWLIST = Object.freeze([
    PINNED_CHECKOUT_ACTION,
    PINNED_DOWNLOAD_ARTIFACT_ACTION,
    PINNED_UPLOAD_ARTIFACT_ACTION,
]);
const BUILD_ACTION_ALLOWLIST = Object.freeze([
    'actions/cache/restore@v4',
    'actions/cache/save@v4',
    'actions/cache@v4',
    'actions/checkout@v4',
    'actions/download-artifact@v4',
    'actions/setup-node@v4',
    'actions/upload-artifact@v4',
    'pnpm/action-setup@v4',
    'softprops/action-gh-release@v2',
]);
const VERIFY_JOB_ID = 'verify-snap';
const PUBLISH_JOB_ID = 'publish-snap';
const VERIFY_JOB_CONDITION =
    "${{ startsWith(github.event.release.tag_name, 'v') && github.event.release.draft == false }}";
const PUBLISH_JOB_CONDITION =
    "${{ needs.verify-snap.result == 'success' && startsWith(github.event.release.tag_name, 'v') && github.event.release.draft == false }}";
const VERIFIED_RELEASE_ARTIFACT_NAME = 'verified-snap-release-assets';
const PUBLISH_STEP_NAME = 'Publish all public-release snaps to edge';
const PUBLISH_CHECKOUT_STEP_NAME = 'Checkout released tooling';
const PUBLISH_CHECKOUT_STEP_CONTRACT = Object.freeze({
    name: PUBLISH_CHECKOUT_STEP_NAME,
    uses: PINNED_CHECKOUT_ACTION,
    with: {
        ref: '${{ github.event.release.tag_name }}',
        'persist-credentials': false,
    },
});
const PUBLISH_SNAPCRAFT_SETUP_STEP_NAME = 'Install Snapcraft';
const PUBLISH_SNAPCRAFT_SETUP_STEP_CONTRACT = Object.freeze({
    name: PUBLISH_SNAPCRAFT_SETUP_STEP_NAME,
    shell: 'bash',
    run: [
        'set -euo pipefail',
        '',
        'sudo snap install snapcraft --classic --channel=stable',
        '',
    ].join('\n'),
});
const VERIFY_ARTIFACT_UPLOAD_STEP_NAME = 'Transfer verified release assets';
const VERIFY_ARTIFACT_UPLOAD_STEP_CONTRACT = Object.freeze({
    name: VERIFY_ARTIFACT_UPLOAD_STEP_NAME,
    uses: PINNED_UPLOAD_ARTIFACT_ACTION,
    with: {
        name: VERIFIED_RELEASE_ARTIFACT_NAME,
        path: '/var/lib/iptvnator-snap-release/assets',
        'if-no-files-found': 'error',
        'retention-days': 1,
        'compression-level': 0,
        'include-hidden-files': true,
    },
});
const PUBLISH_ARTIFACT_DOWNLOAD_STEP_NAME = 'Download verified release assets';
const PUBLISH_ARTIFACT_DOWNLOAD_STEP_CONTRACT = Object.freeze({
    name: PUBLISH_ARTIFACT_DOWNLOAD_STEP_NAME,
    uses: PINNED_DOWNLOAD_ARTIFACT_ACTION,
    with: {
        name: VERIFIED_RELEASE_ARTIFACT_NAME,
        path: '${{ runner.temp }}/verified-snap-release-assets',
    },
});
const PUBLISH_SEALED_VERIFY_STEP_NAME = 'Reverify sealed public release assets';
const PUBLISH_SEALED_VERIFY_STEP_CONTRACT = Object.freeze({
    name: PUBLISH_SEALED_VERIFY_STEP_NAME,
    shell: 'bash',
    run: [
        'set -euo pipefail',
        '',
        'VERIFIED_ASSET_DIRECTORY="/var/lib/iptvnator-snap-release/assets"',
        'node tools/packaging/release-snap-assets.cjs verify-sealed \\',
        '    --manifest "${RUNNER_TEMP}/selected-snap-release-assets.json" \\',
        '    --directory "${VERIFIED_ASSET_DIRECTORY}" \\',
        '    --receipt "${VERIFIED_ASSET_DIRECTORY}/verified-release-assets.json" \\',
        '    --repository-revision "$(git rev-parse HEAD)"',
        '',
    ].join('\n'),
});
const VERIFY_TRANSFER_BINDING_STEP_NAME = 'Bind verified release transfer';
const VERIFY_TRANSFER_BINDING_STEP_CONTRACT = Object.freeze({
    name: VERIFY_TRANSFER_BINDING_STEP_NAME,
    id: 'bind-transfer',
    shell: 'bash',
    run: [
        'set -euo pipefail',
        '',
        'RECEIPT_PATH="/var/lib/iptvnator-snap-release/assets/verified-release-assets.json"',
        'RECEIPT_RECORD="$(/usr/bin/sha256sum --binary "${RECEIPT_PATH}")"',
        'RECEIPT_SHA256="${RECEIPT_RECORD%% *}"',
        '[[ "${RECEIPT_SHA256}" =~ ^[a-f0-9]{64}$ ]]',
        `printf 'receipt-sha256=%s\\n' "\${RECEIPT_SHA256}" >> "\${GITHUB_OUTPUT}"`,
        '',
    ].join('\n'),
});
const PUBLISH_TRANSFER_VERIFY_STEP_NAME =
    'Seal transferred public release assets';
const PUBLISH_TRANSFER_VERIFY_STEP_CONTRACT = Object.freeze({
    name: PUBLISH_TRANSFER_VERIFY_STEP_NAME,
    shell: 'bash',
    env: {
        EXPECTED_RECEIPT_SHA256:
            '${{ needs.verify-snap.outputs.receipt-sha256 }}',
    },
    run: [
        'set -euo pipefail',
        '',
        'TRANSFERRED_ASSET_DIRECTORY="${RUNNER_TEMP}/verified-snap-release-assets"',
        'SEALED_ASSET_PARENT="/var/lib/iptvnator-snap-release"',
        'SEALED_ASSET_DIRECTORY="${SEALED_ASSET_PARENT}/assets"',
        'test -d "${TRANSFERRED_ASSET_DIRECTORY}"',
        'test ! -L "${TRANSFERRED_ASSET_DIRECTORY}"',
        'shopt -s nullglob dotglob',
        'TRANSFERRED_FILES=("${TRANSFERRED_ASSET_DIRECTORY}"/*)',
        'TRANSFERRED_SNAPS=("${TRANSFERRED_ASSET_DIRECTORY}"/*.snap)',
        'test "${#TRANSFERRED_SNAPS[@]}" -gt 0',
        'test "${#TRANSFERRED_FILES[@]}" -eq "$(( ${#TRANSFERRED_SNAPS[@]} + 2 ))"',
        'test -f "${TRANSFERRED_ASSET_DIRECTORY}/linux-frame-copy-runtime-sources.tar.xz"',
        'test ! -L "${TRANSFERRED_ASSET_DIRECTORY}/linux-frame-copy-runtime-sources.tar.xz"',
        'test -f "${TRANSFERRED_ASSET_DIRECTORY}/verified-release-assets.json"',
        'test ! -L "${TRANSFERRED_ASSET_DIRECTORY}/verified-release-assets.json"',
        'for ASSET_FILE in "${TRANSFERRED_FILES[@]}"; do',
        '    test -f "${ASSET_FILE}"',
        '    test ! -L "${ASSET_FILE}"',
        'done',
        'RECEIPT_PATH="${TRANSFERRED_ASSET_DIRECTORY}/verified-release-assets.json"',
        'RECEIPT_RECORD="$(/usr/bin/sha256sum --binary "${RECEIPT_PATH}")"',
        'ACTUAL_RECEIPT_SHA256="${RECEIPT_RECORD%% *}"',
        '[[ "${EXPECTED_RECEIPT_SHA256}" =~ ^[a-f0-9]{64}$ ]]',
        'test "${ACTUAL_RECEIPT_SHA256}" = "${EXPECTED_RECEIPT_SHA256}"',
        "/usr/bin/jq --exit-status '",
        '    type == "object" and',
        '    (keys == ["assets", "repositoryRevision", "schemaVersion"]) and',
        '    (.schemaVersion == 1) and',
        '    (.repositoryRevision |',
        '        type == "string" and test("^[a-f0-9]{40,64}$")) and',
        '    (.assets | type == "array" and length >= 2) and',
        '    (.assets | all(.[];',
        '        type == "object" and',
        '        (keys == ["id", "name", "sha256", "size"]) and',
        '        (.id |',
        '            type == "number" and . > 0 and',
        '            . <= 9007199254740991 and . == floor) and',
        '        (.name |',
        '            type == "string" and length > 0 and',
        '            . != "." and . != ".." and',
        '            (contains("/") | not) and',
        '            (contains("\\\\") | not) and',
        '            (explode | all(.[]; . > 31 and . != 127))) and',
        '        (.sha256 |',
        '            type == "string" and test("^[a-f0-9]{64}$")) and',
        '        (.size |',
        '            type == "number" and . > 0 and',
        '            . <= 9007199254740991 and . == floor))) and',
        '    ([.assets[].name] | length == (unique | length)) and',
        '    ([.assets[] |',
        '        select(.name == "linux-frame-copy-runtime-sources.tar.xz")] |',
        '        length == 1) and',
        '    ([.assets[] | select(.name | endswith(".snap"))] |',
        '        length >= 1) and',
        '    (.assets | all(.[];',
        '        .name == "linux-frame-copy-runtime-sources.tar.xz" or',
        '        (.name | endswith(".snap"))))',
        '\' "${RECEIPT_PATH}" > /dev/null',
        `RECEIPT_ASSET_COUNT="$(/usr/bin/jq --raw-output '.assets | length' "\${RECEIPT_PATH}")"`,
        'test "${RECEIPT_ASSET_COUNT}" -eq "$(( ${#TRANSFERRED_SNAPS[@]} + 1 ))"',
        'SIZE_MANIFEST="${RUNNER_TEMP}/verified-release-asset-sizes.tsv"',
        'CHECKSUM_MANIFEST="${RUNNER_TEMP}/verified-release-asset-checksums.txt"',
        'umask 077',
        '/usr/bin/jq --raw-output \\',
        `    '.assets[] | [.name, (.size | tostring)] | @tsv' \\`,
        '    "${RECEIPT_PATH}" > "${SIZE_MANIFEST}"',
        `while IFS=$'\\t' read -r ASSET_NAME EXPECTED_SIZE; do`,
        '    ASSET_PATH="${TRANSFERRED_ASSET_DIRECTORY}/${ASSET_NAME}"',
        '    ACTUAL_SIZE="$(/usr/bin/stat --format=%s -- "${ASSET_PATH}")"',
        '    test "${ACTUAL_SIZE}" = "${EXPECTED_SIZE}"',
        'done < "${SIZE_MANIFEST}"',
        '/usr/bin/jq --raw-output \\',
        `    '.assets[] | "\\(.sha256)  \\(.name)"' \\`,
        '    "${RECEIPT_PATH}" > "${CHECKSUM_MANIFEST}"',
        '(',
        '    cd "${TRANSFERRED_ASSET_DIRECTORY}"',
        '    /usr/bin/sha256sum --strict --check "${CHECKSUM_MANIFEST}"',
        ')',
        'rm -f "${SIZE_MANIFEST}" "${CHECKSUM_MANIFEST}"',
        'shopt -u nullglob dotglob',
        'sudo test ! -e "${SEALED_ASSET_PARENT}"',
        'sudo install -d -m 0700 -o root -g root "${SEALED_ASSET_PARENT}"',
        'sudo mv "${TRANSFERRED_ASSET_DIRECTORY}" "${SEALED_ASSET_DIRECTORY}"',
        'sudo chown -R root:root "${SEALED_ASSET_DIRECTORY}"',
        'sudo find "${SEALED_ASSET_DIRECTORY}" -type d -exec chmod 0555 {} +',
        'sudo find "${SEALED_ASSET_DIRECTORY}" -type f -exec chmod 0444 {} +',
        'sudo chmod 0555 "${SEALED_ASSET_PARENT}"',
        '',
    ].join('\n'),
});
const PUBLISH_STEP_CONTRACT = Object.freeze({
    name: PUBLISH_STEP_NAME,
    shell: 'bash',
    env: {
        SNAPCRAFT_STORE_CREDENTIALS: '${{ secrets.snapcraft_token }}',
    },
    run: [
        'set -euo pipefail',
        '',
        'VERIFIED_ASSET_DIRECTORY="/var/lib/iptvnator-snap-release/assets"',
        'STORE_CREDENTIALS="${SNAPCRAFT_STORE_CREDENTIALS}"',
        'unset SNAPCRAFT_STORE_CREDENTIALS',
        'shopt -s nullglob dotglob',
        'SNAP_FILES=("${VERIFIED_ASSET_DIRECTORY}"/*.snap)',
        'test "${#SNAP_FILES[@]}" -gt 0',
        'for SNAP_FILE in "${SNAP_FILES[@]}"; do',
        '    SNAP_NAME="${SNAP_FILE##*/}"',
        '    echo "Publishing public release asset: ${SNAP_NAME}"',
        '    # Candidate/stable promotion is manual after installed-Snap frame-copy and missing-runtime fallback smoke.',
        '    # GitHub Actions never promotes automatically.',
        '    SNAPCRAFT_STORE_CREDENTIALS="${STORE_CREDENTIALS}" /snap/bin/snapcraft upload --release=edge "${SNAP_FILE}"',
        'done',
        'unset STORE_CREDENTIALS',
        'shopt -u nullglob dotglob',
        '',
    ].join('\n'),
});

function stripShellComment(line) {
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (quote === "'") {
            if (character === quote) {
                quote = null;
            }
            continue;
        }
        if (character === '\\') {
            index += 1;
            continue;
        }
        if (quote === '"') {
            if (character === quote) {
                quote = null;
            }
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
            continue;
        }
        if (
            character === '#' &&
            (index === 0 || /[\s;|&()]/.test(line[index - 1]))
        ) {
            return line.slice(0, index);
        }
    }
    return line;
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRunSource(runSource) {
    return runSource
        .split('\n')
        .map(stripShellComment)
        .join('\n')
        .replace(/\\\r?\n[ \t]*/g, '');
}

function collectDefaultShell(container, containerName, explicitShells) {
    if (!Object.hasOwn(container, 'defaults')) {
        return;
    }
    assert.ok(
        isRecord(container.defaults),
        `${containerName} defaults must be a mapping`
    );
    if (!Object.hasOwn(container.defaults, 'run')) {
        return;
    }
    assert.ok(
        isRecord(container.defaults.run),
        `${containerName} run defaults must be a mapping`
    );
    if (!Object.hasOwn(container.defaults.run, 'shell')) {
        return;
    }
    assert.equal(
        typeof container.defaults.run.shell,
        'string',
        `${containerName} default shell must resolve to a string`
    );
    explicitShells.push(container.defaults.run.shell);
}

function collectWorkflowPolicyInputs(workflowText) {
    const workflow = parse(workflowText);
    assert.ok(isRecord(workflow), 'workflow must be a YAML mapping');
    assert.ok(isRecord(workflow.jobs), 'workflow jobs must be a YAML mapping');

    const actions = [];
    const explicitShells = [];
    const jobActions = [];
    const jobsWithoutSteps = [];
    const runSources = [];
    collectDefaultShell(workflow, 'workflow', explicitShells);
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
        assert.ok(isRecord(job), `workflow job "${jobName}" must be a mapping`);
        collectDefaultShell(job, `workflow job "${jobName}"`, explicitShells);
        if (Object.hasOwn(job, 'uses')) {
            assert.equal(
                typeof job.uses,
                'string',
                'reusable workflow identifiers must resolve to strings'
            );
            jobActions.push(job.uses);
        }
        if (!Array.isArray(job.steps)) {
            jobsWithoutSteps.push(jobName);
            continue;
        }
        for (const step of job.steps) {
            assert.ok(isRecord(step), 'workflow steps must be mappings');
            if (Object.hasOwn(step, 'uses')) {
                assert.equal(
                    typeof step.uses,
                    'string',
                    'workflow action identifiers must resolve to strings'
                );
                actions.push(step.uses);
            }
            if (Object.hasOwn(step, 'run')) {
                assert.equal(
                    typeof step.run,
                    'string',
                    'workflow run commands must resolve to strings'
                );
                runSources.push(normalizeRunSource(step.run));
            }
            if (Object.hasOwn(step, 'shell')) {
                assert.equal(
                    typeof step.shell,
                    'string',
                    'workflow step shells must resolve to strings'
                );
                explicitShells.push(step.shell);
            }
        }
    }

    return {
        actions,
        commandSource: runSources.join('\n'),
        explicitShells,
        jobActions,
        jobsWithoutSteps,
        workflow,
    };
}

function assertWorkflowExecutionShape({
    explicitShells,
    jobActions,
    jobsWithoutSteps,
}) {
    assert.deepEqual(
        jobActions,
        [],
        'job-level reusable workflow delegation is not allowed'
    );
    assert.deepEqual(
        jobsWithoutSteps,
        [],
        'every workflow job must define a concrete steps sequence'
    );
    assert.deepEqual(
        explicitShells.filter((shell) => shell !== 'bash'),
        [],
        'every explicit workflow shell must be exactly "bash"'
    );
}

function literalSnapcraftTokens(commandSource) {
    return commandSource.match(/\bsnapcraft\b/g) ?? [];
}

export function assertPublishSnapWorkflowPolicy(workflowText) {
    const policyInputs = collectWorkflowPolicyInputs(workflowText);
    const { actions, commandSource, workflow } = policyInputs;
    assertWorkflowExecutionShape(policyInputs);
    assert.deepEqual(
        workflow.on,
        { release: { types: ['published'] } },
        'the publish workflow must retain its exact release trigger'
    );
    assert.deepEqual(
        Object.keys(workflow).sort(),
        ['jobs', 'name', 'on', 'permissions'],
        'the publish workflow must not add global execution or environment surfaces'
    );
    assert.deepEqual(
        workflow.permissions,
        { contents: 'read' },
        'the publish workflow must retain read-only repository permissions'
    );
    assert.deepEqual(
        [...actions].sort(),
        [...PUBLISH_ACTION_ALLOWLIST].sort(),
        'the publish workflow must use exactly the allowlisted actions'
    );
    assert.deepEqual(
        Object.keys(workflow.jobs),
        [VERIFY_JOB_ID, PUBLISH_JOB_ID],
        'the publish workflow must isolate verification and credentialed upload on two exact jobs'
    );
    const verifyJob = workflow.jobs[VERIFY_JOB_ID];
    const publishJob = workflow.jobs[PUBLISH_JOB_ID];
    assert.ok(isRecord(verifyJob), 'the canonical verification job must exist');
    assert.ok(isRecord(publishJob), 'the canonical publish job must exist');
    assert.deepEqual(
        Object.keys(verifyJob).sort(),
        ['env', 'if', 'name', 'outputs', 'runs-on', 'steps', 'timeout-minutes'],
        'the verification job must retain its exact execution surface'
    );
    assert.deepEqual(
        verifyJob.env,
        {
            SOURCE_ARCHIVE_NAME: 'linux-frame-copy-runtime-sources.tar.xz',
        },
        'the verification job must expose only the fixed source archive name'
    );
    assert.deepEqual(
        verifyJob.outputs,
        {
            'receipt-sha256':
                '${{ steps.bind-transfer.outputs.receipt-sha256 }}',
        },
        'the verification job must expose only the separately bound receipt digest'
    );
    assert.deepEqual(
        Object.keys(publishJob).sort(),
        ['if', 'name', 'needs', 'runs-on', 'steps', 'timeout-minutes'],
        'the fresh credentialed job must retain its exact execution surface'
    );
    assert.equal(
        verifyJob['runs-on'],
        'ubuntu-latest',
        'the verification job must use a fresh GitHub-hosted runner'
    );
    assert.equal(
        publishJob['runs-on'],
        'ubuntu-latest',
        'the credentialed job must use a separate fresh GitHub-hosted runner'
    );
    assert.equal(
        verifyJob['timeout-minutes'],
        45,
        'the verification job must retain its bounded timeout'
    );
    assert.equal(
        publishJob['timeout-minutes'],
        20,
        'the credentialed job must retain its bounded timeout'
    );
    assert.equal(
        verifyJob.if,
        VERIFY_JOB_CONDITION,
        'the verification job must retain its exact release condition'
    );
    assert.equal(
        publishJob.needs,
        VERIFY_JOB_ID,
        'the publish job must depend on successful isolated verification'
    );
    assert.equal(
        publishJob.if,
        PUBLISH_JOB_CONDITION,
        'the publish job must retain its exact verified-release condition'
    );
    assert.deepEqual(
        verifyJob.steps.filter(
            (step) => step.name === PUBLISH_CHECKOUT_STEP_NAME
        ),
        [PUBLISH_CHECKOUT_STEP_CONTRACT],
        'the publish workflow must checkout released tooling without persisting repository credentials'
    );
    assert.deepEqual(
        verifyJob.steps.filter(
            (step) => step.name === PUBLISH_SEALED_VERIFY_STEP_NAME
        ),
        [PUBLISH_SEALED_VERIFY_STEP_CONTRACT],
        'the verification job must fully verify root-sealed assets before transfer'
    );
    assert.deepEqual(
        verifyJob.steps.filter(
            (step) => step.name === VERIFY_ARTIFACT_UPLOAD_STEP_NAME
        ),
        [VERIFY_ARTIFACT_UPLOAD_STEP_CONTRACT],
        'the verification job must transfer only the root-sealed verified data artifact'
    );
    assert.deepEqual(
        verifyJob.steps.filter(
            (step) => step.name === VERIFY_TRANSFER_BINDING_STEP_NAME
        ),
        [VERIFY_TRANSFER_BINDING_STEP_CONTRACT],
        'the verification job must bind the exact receipt outside artifact transport'
    );
    assert.deepEqual(
        publishJob.steps,
        [
            PUBLISH_ARTIFACT_DOWNLOAD_STEP_CONTRACT,
            PUBLISH_TRANSFER_VERIFY_STEP_CONTRACT,
            PUBLISH_SNAPCRAFT_SETUP_STEP_CONTRACT,
            PUBLISH_STEP_CONTRACT,
        ],
        'the fresh publish runner must only download, validate, seal, install Snapcraft, and upload'
    );
    assert.equal(
        JSON.stringify(verifyJob).includes('snapcraft_token'),
        false,
        'the release-tag verification job must never receive the Store credential'
    );
    assert.equal(
        publishJob.steps
            .slice(0, -1)
            .some((step) => JSON.stringify(step).includes('snapcraft_token')),
        false,
        'only the final credentialed upload step may receive the Store credential'
    );
    assert.equal(
        literalSnapcraftTokens(commandSource).length,
        2,
        'the publish workflow must contain exactly the reviewed install and upload Snapcraft commands'
    );
}

export function assertBuildSnapWorkflowPolicy(workflowText) {
    const policyInputs = collectWorkflowPolicyInputs(workflowText);
    const { actions, commandSource } = policyInputs;
    assertWorkflowExecutionShape(policyInputs);
    assert.deepEqual(
        actions.filter((action) => !BUILD_ACTION_ALLOWLIST.includes(action)),
        [],
        'the build workflow must use only allowlisted actions'
    );
    assert.equal(
        literalSnapcraftTokens(commandSource).length,
        0,
        'the build workflow must not contain a literal Snapcraft token'
    );
}
