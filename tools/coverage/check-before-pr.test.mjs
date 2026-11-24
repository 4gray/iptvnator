import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';

function fixture(t, { run, baseline = 100 }) {
    const cwd = mkdtempSync(join(tmpdir(), 'check-before-pr-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const git = (...args) =>
        execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    git('config', 'user.email', 'test@example.test');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');

    const coverageTools = join(cwd, 'tools', 'coverage');
    const performanceTools = join(cwd, 'tools', 'performance');
    mkdirSync(coverageTools, { recursive: true });
    mkdirSync(performanceTools, { recursive: true });
    const script = join(coverageTools, 'check-before-pr.mjs');
    copyFileSync(new URL('./check-before-pr.mjs', import.meta.url), script);
    for (const name of [
        'check-baseline-direction.mjs',
        'check-journey-ratchet.mjs',
    ]) {
        copyFileSync(
            new URL(`../performance/${name}`, import.meta.url),
            join(performanceTools, name)
        );
    }
    writeFileSync(
        join(coverageTools, 'unit-coverage-scope.mjs'),
        `
        import assert from 'node:assert/strict';
        export async function checkUnitCoverageScope(files, base) {
            assert.deepEqual(files, ${JSON.stringify(baseline === 100 ? ['example file.ts'] : ['example file.ts', 'tools/performance/journey-baselines.json'])});
            assert.match(base, /^[0-9a-f]+$/);
            return { run: ${run} };
        }
    `
    );
    writeFileSync(
        join(cwd, 'pnpm.cjs'),
        `
        console.log(process.argv.slice(2).join(' '));
        process.exitCode = process.argv[3] === process.env.FAIL_SCRIPT ? 1 : 0;
    `
    );
    writeFileSync(
        join(cwd, 'pnpm'),
        '#!/bin/sh\nexec node "$(dirname "$0")/pnpm.cjs" "$@"\n',
        { mode: 0o755 }
    );
    writeFileSync(join(cwd, 'pnpm.cmd'), '@node "%~dp0pnpm.cjs" %*\r\n');
    mkdirSync(join(cwd, 'coverage', 'merged'), { recursive: true });
    writeFileSync(
        join(cwd, 'coverage', 'merged', 'lcov.info'),
        [
            'SF:example file.ts',
            'DA:1,0',
            'DA:2,2',
            'DA:3,0',
            'BRDA:2,0,0,2',
            'BRDA:2,0,1,0',
            'end_of_record',
            '',
        ].join('\n')
    );

    const source = join(cwd, 'example file.ts');
    const writeBaseline = (value) =>
        writeFileSync(
            join(performanceTools, 'journey-baselines.json'),
            JSON.stringify({
                version: 1,
                journeys: {
                    launch: {
                        'renderer.initialBytes': { value, unit: 'bytes' },
                    },
                },
            })
        );
    writeBaseline(100);
    writeFileSync(source, 'unchanged\nold\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(source, 'unchanged\nchanged\nadded\n');
    writeBaseline(baseline);
    git('commit', '--quiet', '-am', 'change');
    return (failScript = '', ...args) =>
        spawnSync(process.execPath, [script, base, ...args], {
            cwd,
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${cwd}${delimiter}${process.env.PATH}`,
                FAIL_SCRIPT: failScript,
            },
        });
}

test('checks the ratchet and reports only missing coverage on changed lines', (t) => {
    const check = fixture(t, { run: true });
    const { status, stdout, stderr } = check();
    assert.equal(status, 0, stderr);
    assert.match(
        stdout,
        /nx build web --skip-nx-cache[\s\S]*run perf:initial-bytes:check[\s\S]*run coverage:ci/
    );
    assert.match(
        stdout,
        /example file\.ts.*uncovered lines: 3.*uncovered branches: 2/
    );
});

test('skips Tier A when it is out of scope', (t) => {
    const check = fixture(t, { run: false });
    const { status, stdout, stderr } = check();
    assert.equal(status, 0, stderr);
    assert.match(stdout, /run perf:initial-bytes:check/);
    assert.doesNotMatch(stdout, /run coverage:ci|uncovered lines/);
});

test('stops at a failing ratchet', (t) => {
    const check = fixture(t, { run: true });
    const { status, stdout } = check('perf:initial-bytes:check');
    assert.equal(status, 1);
    assert.match(stdout, /run perf:initial-bytes:check/);
    assert.doesNotMatch(stdout, /run coverage:ci/);
});

test('reports fresh patch gaps before a failing coverage health check', (t) => {
    const check = fixture(t, { run: true });
    const healthFailed = check('coverage:health');
    assert.equal(healthFailed.status, 1);
    assert.match(
        healthFailed.stdout,
        /run coverage:ci:report[\s\S]*uncovered lines: 3[\s\S]*run coverage:health --require-report/
    );

    const reportFailed = check('coverage:ci:report');
    assert.equal(reportFailed.status, 1);
    assert.doesNotMatch(
        reportFailed.stdout,
        /uncovered lines|run coverage:health/
    );
});

test('refuses to build with a raised baseline unless explicitly allowed', (t) => {
    const check = fixture(t, { run: false, baseline: 101 });
    const { status, stderr, stdout } = check();
    assert.equal(status, 1);
    assert.match(stderr, /baseline raised from 100 to 101 bytes/);
    assert.doesNotMatch(stdout, /nx build web/);

    const allowed = check('', '--allow-increase');
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.match(
        allowed.stdout,
        /ALLOWED .*baseline raised from 100 to 101 bytes/
    );
    assert.match(allowed.stdout, /weakened by local --allow-increase/);
    assert.match(allowed.stdout, /nx build web/);
});
