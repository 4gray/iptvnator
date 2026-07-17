import assert from 'node:assert/strict';
import { parse } from 'yaml';

const PUBLISH_ACTION_ALLOWLIST = Object.freeze([
    'actions/checkout@v4',
    'samuelmeuli/action-snapcraft@v3',
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
const PUBLISH_JOB_ID = 'publish-snap';
const PUBLISH_JOB_CONDITION =
    "${{ startsWith(github.event.release.tag_name, 'v') && github.event.release.draft == false }}";
const PUBLISH_STEP_NAME = 'Publish all public-release snaps to edge';
const PUBLISH_STEP_CONTRACT = Object.freeze({
    name: PUBLISH_STEP_NAME,
    shell: 'bash',
    run: [
        'set -euo pipefail',
        '',
        'node -e \\',
        `    "const fs=require('node:fs'); const selected=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); for (const asset of selected.snapAssets) console.log(asset.name);" \\`,
        '    "${RUNNER_TEMP}/selected-snap-release-assets.json" |',
        '    while IFS= read -r SNAP_NAME; do',
        '        SNAP_FILE="${RUNNER_TEMP}/snap-release-downloads/${SNAP_NAME}"',
        '        echo "Publishing public release asset: ${SNAP_NAME}"',
        '        # Candidate/stable promotion is manual after installed-Snap frame-copy and missing-runtime fallback smoke.',
        '        # GitHub Actions never promotes automatically.',
        '        snapcraft upload --release=edge "${SNAP_FILE}"',
        '    done',
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
        [...actions].sort(),
        [...PUBLISH_ACTION_ALLOWLIST].sort(),
        'the publish workflow must use exactly the allowlisted actions'
    );
    const publishJob = workflow.jobs[PUBLISH_JOB_ID];
    assert.ok(isRecord(publishJob), 'the canonical publish job must exist');
    assert.equal(
        publishJob.if,
        PUBLISH_JOB_CONDITION,
        'the publish job must retain its exact release condition'
    );
    assert.deepEqual(
        publishJob.steps.filter((step) => step.name === PUBLISH_STEP_NAME),
        [PUBLISH_STEP_CONTRACT],
        'the publish workflow must retain the exact reviewed publication step'
    );
    assert.equal(
        literalSnapcraftTokens(commandSource).length,
        1,
        'the publish workflow must contain exactly one literal Snapcraft command'
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
