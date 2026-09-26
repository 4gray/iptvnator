import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import {
    decideUnitCoverageScope,
    isScriptsOnlyChange,
    isSkippable,
} from './unit-coverage-scope.mjs';

const scriptPath = fileURLToPath(
    new URL('./unit-coverage-scope.mjs', import.meta.url)
);

let workDir;
before(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'unit-coverage-scope-'));
});
after(async () => {
    await rm(workDir, { recursive: true, force: true });
});

test('skips a change made only of docs, notes, website and e2e files', () => {
    const decision = decideUnitCoverageScope([
        'docs/architecture/validation-map.md',
        'README.md',
        '.changes/web-thing.md',
        '.plans/2026-09-26-x.md',
        'apps/website/src/pages/index.astro',
        'apps/web-e2e/src/settings.e2e.ts',
        'apps/electron-backend-e2e/src/journeys/launch.journey.ts',
        'apps/xtream-mock-server/src/main.ts',
        '.github/workflows/e2e-tests.yaml',
        'tools/release/build-release-notes.mjs',
        'tools/testing/website-guides.test.mjs',
        '',
    ]);
    assert.equal(decision.run, false);
    assert.deepEqual(decision.blocking, []);
    assert.match(decision.reason, /All 11 changed files/);
});

test('runs when any file can reach a Tier A test', () => {
    for (const file of [
        'apps/web/src/app/app.component.ts',
        'apps/electron-backend/src/main.ts',
        'libs/services/src/lib/x.ts',
        'libs/ui/playback/README.md.ts',
        '.github/workflows/ci.yml',
        'tools/coverage/run-tier-a-coverage.mjs',
        'tools/testing/run-web-esm-lib-tests.mjs',
        'jest.preset.js',
        'jest.web-esm.workspace.ts',
        'tsconfig.base.json',
        'pnpm-lock.yaml',
        'patches/vite.patch',
        'electron-builder.json',
        'nx.json',
        'package.json',
        'some-new-root-file.json',
    ]) {
        const decision = decideUnitCoverageScope(['docs/a.md', file]);
        assert.equal(decision.run, true, file);
        assert.deepEqual(decision.blocking, [file]);
    }
});

test('an empty file list runs the suite rather than skipping it', () => {
    assert.equal(decideUnitCoverageScope([]).run, true);
    assert.equal(decideUnitCoverageScope(['', '  ']).run, true);
});

test('package.json is skippable only when the caller proved a scripts-only change', () => {
    assert.equal(
        decideUnitCoverageScope(['package.json'], { packageJsonScriptsOnly: true }).run,
        false
    );
    assert.equal(decideUnitCoverageScope(['package.json']).run, true);
    assert.equal(isSkippable('package.json'), false);
});

test('detects a scripts-only package.json change', () => {
    const base = JSON.stringify({
        name: 'x',
        version: '1.0.0',
        scripts: { a: 'node a' },
        devDependencies: { jest: '1' },
    });
    const scripts = JSON.stringify({
        name: 'x',
        version: '1.0.0',
        scripts: { a: 'node a', b: 'node b' },
        devDependencies: { jest: '1' },
    });
    const dependency = JSON.stringify({
        name: 'x',
        version: '1.0.0',
        scripts: { a: 'node a' },
        devDependencies: { jest: '2' },
    });
    const version = JSON.stringify({
        name: 'x',
        version: '1.1.0',
        scripts: { a: 'node a' },
        devDependencies: { jest: '1' },
    });
    assert.equal(isScriptsOnlyChange(base, scripts), true);
    assert.equal(isScriptsOnlyChange(base, dependency), false);
    assert.equal(isScriptsOnlyChange(base, version), false);
    assert.equal(isScriptsOnlyChange(base, '{not json'), false);
});

test('CLI prints the decision and writes run=false to GITHUB_OUTPUT', async () => {
    const outputFile = path.join(workDir, 'github-output');
    const result = spawnSync(process.execPath, [scriptPath, '--github-output'], {
        input: 'docs/a.md\n.changes/b.md\n',
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: outputFile },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Tier A unit coverage: skip\./);
    assert.equal(await readFile(outputFile, 'utf8'), 'run=false\n');
});

test('CLI lists the files that need tests and writes run=true', async () => {
    const outputFile = path.join(workDir, 'github-output-run');
    const result = spawnSync(process.execPath, [scriptPath, '--github-output'], {
        input: 'docs/a.md\nlibs/services/src/lib/x.ts\n',
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: outputFile },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Tier A unit coverage: run\. 1 of 2 changed files/);
    assert.match(result.stdout, /needs tests: libs\/services\/src\/lib\/x\.ts/);
    assert.equal(await readFile(outputFile, 'utf8'), 'run=true\n');
});

test('CLI refuses --github-output without GITHUB_OUTPUT', () => {
    const env = { ...process.env };
    delete env.GITHUB_OUTPUT;
    const result = spawnSync(process.execPath, [scriptPath, '--github-output'], {
        input: 'docs/a.md\n',
        encoding: 'utf8',
        env,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /needs GITHUB_OUTPUT/);
});
