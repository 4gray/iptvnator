import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { parse } from 'yaml';

import {
    DEFAULT_HEAD_PATH,
    compareBaselineDirection,
    formatDirectionResult,
    parseArgs,
} from './check-baseline-direction.mjs';

const scriptPath = fileURLToPath(
    new URL('./check-baseline-direction.mjs', import.meta.url)
);

const file = (initialBytes, extra = {}) => ({
    version: 1,
    journeys: {
        launch: {
            'renderer.initialBytes': { value: initialBytes, unit: 'bytes' },
            ...extra,
        },
    },
});

let workDir;
before(async () => {
    workDir = await mkdtemp(
        path.join(os.tmpdir(), 'check-baseline-direction-')
    );
});
after(async () => {
    await rm(workDir, { recursive: true, force: true });
});

test('an unchanged or lowered baseline passes', () => {
    const same = compareBaselineDirection({ base: file(100), head: file(100) });
    assert.deepEqual(same.failures, []);
    assert.deepEqual(same.unchanged, ['launch/renderer.initialBytes']);

    const lowered = compareBaselineDirection({
        base: file(100),
        head: file(90),
    });
    assert.deepEqual(lowered.failures, []);
    assert.match(lowered.lowered[0], /100 -> 90 bytes/);
});

test('a raised baseline fails with both values', () => {
    const result = compareBaselineDirection({
        base: file(100),
        head: file(101),
    });
    assert.equal(result.failures.length, 1);
    assert.match(
        result.failures[0],
        /raised from 100 to 101 bytes\. Baselines only move down/
    );
});

test('a removed baseline fails; a new one is reported and passes', () => {
    const removed = compareBaselineDirection({
        base: file(100, { cdTicks: { value: 5 } }),
        head: file(100),
    });
    assert.equal(removed.failures.length, 1);
    assert.match(
        removed.failures[0],
        /launch\/cdTicks: baseline 5 was removed/
    );

    const added = compareBaselineDirection({
        base: file(100),
        head: file(100, { cdTicks: { value: 5 } }),
    });
    assert.deepEqual(added.failures, []);
    assert.deepEqual(added.added, ['launch/cdTicks']);
});

test('a widened or newly added tolerance fails even when the value went down', () => {
    const widened = compareBaselineDirection({
        base: file(100, {
            firstCardMs: { value: 100, unit: 'ms', toleranceRatio: 1.1 },
        }),
        head: file(100, {
            firstCardMs: { value: 99, unit: 'ms', toleranceRatio: 2 },
        }),
    });
    assert.equal(widened.failures.length, 1);
    assert.match(
        widened.failures[0],
        /firstCardMs: toleranceRatio widened from 1\.1 to 2/
    );

    const added = compareBaselineDirection({
        base: file(100),
        head: file(100, undefined) && {
            version: 1,
            journeys: {
                launch: {
                    'renderer.initialBytes': {
                        value: 100,
                        unit: 'bytes',
                        toleranceRatio: 1.25,
                    },
                },
            },
        },
    });
    assert.equal(added.failures.length, 1);
    assert.match(added.failures[0], /toleranceRatio widened from 1 to 1\.25/);
});

test('the enforced limit is what is compared for wall-clock entries', () => {
    const narrowed = compareBaselineDirection({
        base: file(100, {
            firstCardMs: { value: 100, unit: 'ms', toleranceRatio: 1.25 },
        }),
        head: file(100, {
            firstCardMs: { value: 110, unit: 'ms', toleranceRatio: 1 },
        }),
    });
    assert.deepEqual(narrowed.failures, []);
    assert.match(narrowed.lowered[0], /firstCardMs: 125 -> 110 ms/);

    const raisedLimit = compareBaselineDirection({
        base: file(100, {
            firstCardMs: { value: 100, unit: 'ms', toleranceRatio: 1.25 },
        }),
        head: file(100, {
            firstCardMs: { value: 130, unit: 'ms', toleranceRatio: 1.25 },
        }),
    });
    assert.equal(raisedLimit.failures.length, 1);
    assert.match(
        raisedLimit.failures[0],
        /firstCardMs: baseline raised from 125 to 162\.5 ms/
    );
});

test('a widened or newly added slack fails; a narrowed one lowers the limit', () => {
    const withSlack = (value, slack) => ({
        version: 1,
        journeys: {
            launch: {
                'renderer.initialBytes': { value, unit: 'bytes', slack },
            },
        },
    });

    const added = compareBaselineDirection({
        base: file(100),
        head: withSlack(90, 20),
    });
    assert.equal(added.failures.length, 1);
    assert.match(
        added.failures[0],
        /renderer\.initialBytes: slack widened from 0 to 20 bytes/
    );

    const widened = compareBaselineDirection({
        base: withSlack(100, 10),
        head: withSlack(95, 12),
    });
    assert.equal(widened.failures.length, 1);
    assert.match(widened.failures[0], /slack widened from 10 to 12 bytes/);

    const narrowed = compareBaselineDirection({
        base: withSlack(100, 10),
        head: withSlack(100, 4),
    });
    assert.deepEqual(narrowed.failures, []);
    assert.match(narrowed.lowered[0], /110 -> 104 bytes/);

    const raised = compareBaselineDirection({
        base: withSlack(100, 10),
        head: withSlack(101, 10),
    });
    assert.match(raised.failures[0], /baseline raised from 110 to 111 bytes/);
    assert.match(raised.failures[0], /perf-baseline-increase label/);
});

test('a counter value raised behind narrower slack still fails', () => {
    const withSlack = (value, slack) => ({
        version: 1,
        journeys: {
            launch: {
                'renderer.initialBytes': { value, unit: 'bytes', slack },
            },
        },
    });
    const result = compareBaselineDirection({
        base: withSlack(100, 10),
        head: withSlack(105, 0),
    });
    assert.equal(result.failures.length, 1);
    assert.deepEqual(result.lowered, []);
    assert.match(
        result.failures[0],
        /renderer\.initialBytes: baseline value raised from 100 to 105 bytes while slack narrowed from 10 to 0/
    );

    const allowed = compareBaselineDirection({
        base: withSlack(100, 10),
        head: withSlack(105, 0),
        allowIncrease: true,
    });
    assert.deepEqual(allowed.failures, []);
    assert.equal(allowed.allowed.length, 1);
});

for (const [from, to] of [
    [undefined, false],
    [true, false],
    [false, undefined],
    [false, true],
]) {
    test(`changing autoTighten from ${from} to ${to} requires a maintainer decision`, () => {
        const base = file(100, {
            mutations: { value: 733, slack: 20, autoTighten: from },
        });
        for (const value of [733, 700]) {
            const head = file(100, {
                mutations: { value, slack: 20, autoTighten: to },
            });
            const result = compareBaselineDirection({ base, head });
            assert.equal(result.failures.length, 1);
            assert.match(result.failures[0], /autoTighten changed/);
            assert.match(result.failures[0], /perf-baseline-increase label/);
            assert.deepEqual(result.lowered, []);
            assert.deepEqual(result.unchanged, [
                'launch/renderer.initialBytes',
            ]);

            const allowed = compareBaselineDirection({
                base,
                head,
                allowIncrease: true,
            });
            assert.deepEqual(allowed.failures, []);
            assert.deepEqual(allowed.allowed, result.failures);
        }
    });
}

test('equivalent autoTighten policies pass and still allow lowering a baseline', () => {
    for (const [from, to] of [
        [undefined, true],
        [true, undefined],
        [false, false],
    ]) {
        const base = file(100, {
            mutations: { value: 733, slack: 20, autoTighten: from },
        });
        for (const value of [733, 700]) {
            const head = file(100, {
                mutations: { value, slack: 20, autoTighten: to },
            });
            const result = compareBaselineDirection({ base, head });
            assert.deepEqual(result.failures, []);
            assert.deepEqual(result.allowed, []);
            assert.equal(result.lowered.length, value === 700 ? 1 : 0);
            assert.equal(result.unchanged.length, value === 733 ? 2 : 1);
        }
    }
});

test('switching an entry between counter and wall-clock fails', () => {
    const counterToWallClock = compareBaselineDirection({
        base: file(100, { x: { value: 100, slack: 10 } }),
        head: file(100, { x: { value: 105, toleranceRatio: 1 } }),
    });
    assert.equal(counterToWallClock.failures.length, 1);
    assert.deepEqual(counterToWallClock.lowered, []);
    assert.match(
        counterToWallClock.failures[0],
        /launch\/x: changed from a counter entry to a wall-clock entry/
    );

    const wallClockToCounter = compareBaselineDirection({
        base: file(100, { x: { value: 100, toleranceRatio: 1.25 } }),
        head: file(100, { x: { value: 90 } }),
    });
    assert.equal(wallClockToCounter.failures.length, 1);
    assert.match(
        wallClockToCounter.failures[0],
        /changed from a wall-clock entry to a counter entry/
    );

    const allowed = compareBaselineDirection({
        base: file(100, { x: { value: 100, slack: 10 } }),
        head: file(100, { x: { value: 105, toleranceRatio: 1 } }),
        allowIncrease: true,
    });
    assert.deepEqual(allowed.failures, []);
    assert.equal(allowed.allowed.length, 1);
});

test('allowIncrease reports every weakening as allowed instead of failing', () => {
    const result = compareBaselineDirection({
        base: file(100, { cdTicks: { value: 5 } }),
        head: {
            version: 1,
            journeys: {
                launch: {
                    'renderer.initialBytes': {
                        value: 120,
                        unit: 'bytes',
                        slack: 8,
                    },
                },
            },
        },
        allowIncrease: true,
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.allowed.length, 2);
    assert.match(result.allowed[0], /slack widened from 0 to 8 bytes/);
    assert.match(result.allowed[1], /cdTicks: baseline 5 was removed/);
    assert.match(
        formatDirectionResult(result),
        /^ALLOWED {2}launch\/renderer\.initialBytes.*\nALLOWED {2}launch\/cdTicks.*\nBaseline direction OK: 0 unchanged, 0 lowered, 0 added, 2 weakened with the perf-baseline-increase label\.$/
    );

    const lowered = compareBaselineDirection({
        base: file(100),
        head: file(90),
        allowIncrease: true,
    });
    assert.deepEqual(lowered.allowed, []);
    assert.equal(lowered.lowered.length, 1);
});

test('an empty target-branch file cannot be weakened', () => {
    const result = compareBaselineDirection({
        base: { journeys: {} },
        head: file(100),
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.added, ['launch/renderer.initialBytes']);
});

test('formats the outcome', () => {
    assert.match(
        formatDirectionResult(
            compareBaselineDirection({ base: file(100), head: file(90) })
        ),
        /^lowered {2}launch\/renderer\.initialBytes: 100 -> 90 bytes\.\nBaseline direction OK: 0 unchanged, 1 lowered, 0 added\.$/
    );
    assert.match(
        formatDirectionResult(
            compareBaselineDirection({ base: file(100), head: file(200) })
        ),
        /^FAIL {5}launch.*\nBaseline direction check failed: 1 entries weakened or policy changed\.$/
    );
});

test('parses arguments and requires --base', () => {
    assert.deepEqual(parseArgs(['--base', 'b.json']), {
        base: 'b.json',
        head: DEFAULT_HEAD_PATH,
        allowIncrease: false,
    });
    assert.deepEqual(
        parseArgs(['--', '--base=b.json', '--head=h.json', '--allow-increase']),
        {
            base: 'b.json',
            head: 'h.json',
            allowIncrease: true,
        }
    );
    assert.throws(
        () => parseArgs([]),
        /--base <target-branch-journey-baselines\.json> is required/
    );
    assert.throws(() => parseArgs(['--base']), /Missing value for --base/);
    assert.throws(
        () => parseArgs(['--base', 'b', '--force']),
        /Unknown argument: --force/
    );
});

async function runCli(base, head, extraArgs = []) {
    const basePath =
        base === null
            ? path.join(workDir, 'absent.json')
            : path.join(workDir, `base-${Math.random()}.json`);
    const headPath = path.join(workDir, `head-${Math.random()}.json`);
    if (base !== null) await writeFile(basePath, JSON.stringify(base));
    await writeFile(headPath, JSON.stringify(head));
    return spawnSync(
        process.execPath,
        [scriptPath, '--base', basePath, '--head', headPath, ...extraArgs],
        {
            encoding: 'utf8',
        }
    );
}

test('CLI guards automatic-tightening opt-outs in both directions unless explicitly allowed', async () => {
    const enabled = file(100, { mutations: { value: 733, slack: 20 } });
    const disabled = file(100, {
        mutations: { value: 733, slack: 20, autoTighten: false },
    });
    for (const [base, head] of [
        [enabled, disabled],
        [disabled, enabled],
    ]) {
        const blocked = await runCli(base, head);
        assert.equal(blocked.status, 1);
        assert.match(
            blocked.stderr,
            /FAIL +launch\/mutations: autoTighten changed/
        );

        const allowed = await runCli(base, head, ['--allow-increase']);
        assert.equal(allowed.status, 0, allowed.stderr);
        assert.match(
            allowed.stdout,
            /ALLOWED +launch\/mutations: autoTighten changed/
        );
    }
});

test('CLI exits 0 for a lowered baseline, 1 for a raised one, 0 for a raised one with --allow-increase, 0 when the target branch has no file', async () => {
    const lowered = await runCli(file(100), file(90));
    assert.equal(lowered.status, 0, lowered.stderr);
    assert.match(lowered.stdout, /Baseline direction OK/);

    const raised = await runCli(file(100), file(101));
    assert.equal(raised.status, 1);
    assert.match(
        raised.stderr,
        /FAIL {5}launch\/renderer\.initialBytes: baseline raised/
    );

    const allowed = await runCli(file(100), file(101), ['--allow-increase']);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(
        allowed.stdout,
        /ALLOWED {2}launch\/renderer\.initialBytes: baseline raised/
    );

    const noBase = await runCli(null, file(100));
    assert.equal(noBase.status, 0, noBase.stderr);
    assert.match(noBase.stdout, /nothing to weaken/);
});

test(
    'the PR direction check uses the tested merge parent after master advances',
    { skip: process.platform === 'win32' && 'workflow uses Bash' },
    async () => {
        const workflow = parse(
            await readFile(
                new URL('../../.github/workflows/ci.yml', import.meta.url),
                'utf8'
            )
        );
        const steps = workflow.jobs['initial-bytes-ratchet'].steps;
        assert.equal(
            steps.find(({ uses }) => uses?.startsWith('actions/checkout@'))
                .with['fetch-depth'],
            2
        );
        const direction = steps.find(
            ({ name }) =>
                name ===
                'Refuse baseline increases against the previous revision'
        );
        const root = await mkdtemp(path.join(workDir, 'pr-base-'));
        const upstream = path.join(root, 'upstream');
        const checkout = path.join(root, 'checkout');
        const baseline = 'tools/performance/journey-baselines.json';

        const gitEnv = {
            ...Object.fromEntries(
                Object.entries(process.env).filter(
                    ([key]) => !/^GIT_/i.test(key)
                )
            ),
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
        };
        const git = (cwd, ...args) => {
            const result = spawnSync('git', args, {
                cwd,
                env: gitEnv,
                encoding: 'utf8',
            });
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stderr);
            return result.stdout.trim();
        };
        const setBaseline = async (value) => {
            await writeFile(
                path.join(upstream, baseline),
                JSON.stringify(file(value))
            );
            git(upstream, 'add', baseline);
        };

        git(root, 'init', '-q', '-b', 'master', 'upstream');
        git(upstream, 'config', 'user.name', 'Review Fixture');
        git(upstream, 'config', 'user.email', 'fixture@example.test');
        await mkdir(path.join(upstream, 'tools/performance'), {
            recursive: true,
        });
        await setBaseline(100);
        git(upstream, 'commit', '-qm', 'original master');
        git(upstream, 'switch', '-qc', 'topic');
        git(upstream, 'commit', '--allow-empty', '-qm', 'topic');
        git(upstream, 'switch', '-q', 'master');
        git(upstream, 'merge', '-q', '--no-ff', 'topic', '-m', 'tested merge');
        git(upstream, 'update-ref', 'refs/pull/1/merge', 'HEAD');
        await setBaseline(90);
        git(upstream, 'commit', '-qm', 'master advances');
        git(root, 'init', '-q', 'checkout');
        git(checkout, 'remote', 'add', 'origin', pathToFileURL(upstream).href);
        git(
            checkout,
            'fetch',
            '-q',
            '--depth=2',
            'origin',
            'refs/pull/1/merge'
        );
        git(checkout, 'switch', '-q', '--detach', 'FETCH_HEAD');
        const bin = path.join(root, 'bin');
        await mkdir(bin);
        await writeFile(path.join(bin, 'gh'), '#!/bin/sh\nexit 0\n', {
            mode: 0o700,
        });
        const env = {
            ...gitEnv,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            EVENT_NAME: 'pull_request',
            BASE_REF: 'master',
            PR_NUMBER: '1',
            REPOSITORY: 'example/fixture',
            INCREASE_LABEL: 'perf-baseline-increase',
        };
        assert.equal(typeof direction.run, 'string');
        const script = direction.run.replace(
            'node tools/performance/check-baseline-direction.mjs',
            'node "$DIRECTION_SCRIPT"'
        );
        env.DIRECTION_SCRIPT = await realpath(scriptPath);
        const check = () =>
            spawnSync('bash', ['-c', script], {
                cwd: checkout,
                env,
                encoding: 'utf8',
            });
        const unchanged = check();
        assert.ifError(unchanged.error);
        assert.equal(unchanged.status, 0, unchanged.stderr);
        assert.match(unchanged.stdout, /1 unchanged/);

        git(
            checkout,
            'fetch',
            '-q',
            '--depth=1',
            'origin',
            'refs/pull/1/merge'
        );
        const missingParent = check();
        assert.notEqual(missingParent.status, 0);
        assert.doesNotMatch(missingParent.stdout, /Baseline direction OK/);
    }
);
