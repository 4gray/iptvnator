import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { parse } from 'yaml';

import { readResolvedProjects } from './nx-coverage-projects.mjs';
import { tierAExternalReferences } from './tier-a-external-references.mjs';
import {
    declaredWorkspaceInputs,
    decideUnitCoverageScope,
    globToRegExp,
    isScriptsOnlyChange,
    isSkippable,
} from './unit-coverage-scope.mjs';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const policy = JSON.parse(
    await readFile(path.join(workspaceRoot, 'tools/coverage/coverage-policy.json'), 'utf8')
);
const resolvedProjects = await readResolvedProjects();
const readProject = (project) => resolvedProjects[project.name];

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
        '.github/workflows/build-and-make.yaml',
        'tools/embedded-mpv/stage-runtime.mjs',
        'nx.json',
        'package.json',
        'some-new-root-file.json',
    ]) {
        const decision = decideUnitCoverageScope(['docs/a.md', file]);
        assert.equal(decision.run, true, file);
        assert.deepEqual(decision.blocking, [file]);
    }
});

test('every file outside a project that Tier A code refers to keeps the suite running', () => {
    const references = tierAExternalReferences({
        workspaceRoot,
        tierAProjects: policy.unitCoverage.tierA,
    });
    const declaredInputs = declaredWorkspaceInputs(
        policy.unitCoverage.tierA,
        readProject
    );
    // The scan must see the known cross-project reads, or it proves nothing.
    assert.ok(references.has('.github/workflows/build-and-make.yaml'));
    assert.ok(references.has('tools/embedded-mpv/runtime-probe-contract.cjs'));
    const skippable = [...references.keys()].filter(
        (file) => !decideUnitCoverageScope([file], { declaredInputs }).run
    );
    assert.deepEqual(
        skippable.map((file) => `${file} <- ${[...references.get(file)].join(', ')}`),
        [],
        'Tier A code reads these files, so the scope allowlist must not skip them'
    );
});

test('Tier A test targets declare their workspace inputs and they always block', () => {
    const declaredInputs = declaredWorkspaceInputs(
        policy.unitCoverage.tierA,
        readProject
    );
    assert.ok(declaredInputs.includes('tools/embedded-mpv/runtime-probe-contract.cjs'));
    assert.equal(
        decideUnitCoverageScope(['tools/embedded-mpv/runtime-probe-contract.cjs'], {
            declaredInputs,
        }).run,
        true
    );
    assert.deepEqual(
        decideUnitCoverageScope(['tools/release/a.mjs', 'tools/foo/sub/b.ts'], {
            declaredInputs: ['tools/foo/**/*.ts'],
        }).blocking,
        ['tools/foo/sub/b.ts']
    );
});

test('declared-input globs keep ** recursive and * within one segment', () => {
    const deep = globToRegExp('tools/foo/**/*.ts');
    for (const file of ['tools/foo/a.ts', 'tools/foo/a/b.ts', 'tools/foo/a/b/c/d.ts']) {
        assert.ok(deep.test(file), file);
    }
    assert.equal(deep.test('tools/foo/a/b.js'), false);
    assert.equal(deep.test('tools/foobar/a.ts'), false);
    const single = globToRegExp('tools/foo/*.cjs');
    assert.ok(single.test('tools/foo/a.cjs'));
    assert.equal(single.test('tools/foo/a/b.cjs'), false);
    assert.ok(globToRegExp('tools/foo/**').test('tools/foo/a/b/c'));
    assert.ok(globToRegExp('a.b+c').test('a.b+c'));
    assert.equal(globToRegExp('a.b').test('axb'), false);
    assert.equal(
        decideUnitCoverageScope(['tools/release/a/b/c.ts'], {
            declaredInputs: ['tools/release/**/*.ts'],
        }).run,
        true
    );
});

test('an empty file list runs the suite rather than skipping it', () => {
    assert.equal(decideUnitCoverageScope([]).run, true);
    assert.equal(decideUnitCoverageScope(['']).run, true);
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
    const coverageScript = JSON.stringify({
        name: 'x',
        version: '1.0.0',
        scripts: { a: 'node a', 'coverage:ci': 'true' },
        devDependencies: { jest: '1' },
    });
    assert.equal(isScriptsOnlyChange(base, coverageScript), false);
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
    assert.match(result.stdout, /needs tests: "libs\/services\/src\/lib\/x\.ts"/);
    assert.equal(await readFile(outputFile, 'utf8'), 'run=true\n');
});

test('CLI preserves filenames with newlines in a NUL-delimited diff', async () => {
    const outputFile = path.join(workDir, 'github-output-null');
    const result = spawnSync(
        process.execPath,
        [scriptPath, '--null', '--github-output'],
        {
            input: 'fixture.md\ndocs/runtime.ts\0',
            encoding: 'utf8',
            env: { ...process.env, GITHUB_OUTPUT: outputFile },
        }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('needs tests: "fixture.md\\ndocs/runtime.ts"'));
    assert.equal(isSkippable('fixture.md\n'), false);
    assert.equal(await readFile(outputFile, 'utf8'), 'run=true\n');
});

test(
    'CI scopes coverage to the tested merge and checks both paths of a rename',
    { skip: process.platform === 'win32' && 'workflow uses Bash' },
    async () => {
        const workflow = parse(
            await readFile(path.join(workspaceRoot, '.github/workflows/ci.yml'), 'utf8')
        );
        const steps = workflow.jobs['unit-and-typecheck'].steps;
        assert.equal(steps.find((step) => step.name === 'Checkout code').with?.['fetch-depth'], 2);
        const script = steps.find((step) => step.id === 'scope').run;
        const repo = path.join(workDir, 'merge-fixture');
        await mkdir(repo);
        const env = {
            ...Object.fromEntries(
                Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
            ),
            GIT_CONFIG_GLOBAL: os.devNull,
            GIT_CONFIG_NOSYSTEM: '1',
        };
        const git = (...args) => {
            const result = spawnSync(
                'git',
                ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args],
                { cwd: repo, env, encoding: 'utf8' }
            );
            assert.equal(result.status, 0, result.stderr);
            return result.stdout.trim();
        };
        git('init', '-b', 'master');
        await mkdir(path.join(repo, 'docs'));
        await writeFile(path.join(repo, 'fixture.ts'), 'export const fixture = true;\n');
        git('add', '.');
        git('commit', '-m', 'base');
        git('switch', '-c', 'feature');
        await rename(path.join(repo, 'fixture.ts'), path.join(repo, 'docs/fixture.md'));
        await writeFile(path.join(repo, 'HEAD'), 'ambiguous revision name\n');
        git('add', '.');
        git('commit', '-m', 'move runtime fixture to docs');
        git('switch', 'master');
        git('merge', '--no-ff', 'feature');
        const testedMerge = git('rev-parse', 'HEAD');
        git('switch', 'feature');
        git('reset', '--hard', 'master^1');
        await mkdir(path.join(repo, 'docs'));
        await writeFile(path.join(repo, 'docs/later.md'), '# Later push\n');
        git('add', '.');
        git('commit', '-m', 'docs only on the current PR head');
        git('switch', '--detach', testedMerge);

        // Run the workflow's shell and capture the diff it pipes to Node.
        const result = spawnSync(
            'bash',
            ['-c', 'node() { printf "%s\\n" "$@"; cat; }\n' + script],
            { cwd: repo, encoding: 'utf8', env: { ...env, EVENT_NAME: 'pull_request' } }
        );
        assert.equal(result.status, 0, result.stderr);
        const [tool, delimiter, baseFlag, base, outputFlag, diff] = result.stdout.split('\n');
        assert.deepEqual(
            [tool, delimiter, baseFlag, base, outputFlag],
            ['tools/coverage/unit-coverage-scope.mjs', '--null', '--base', 'HEAD^1', '--github-output']
        );
        const decision = decideUnitCoverageScope(diff.split('\0'));
        assert.deepEqual(decision.blocking, ['HEAD', 'fixture.ts']);
        assert.equal(decision.run, true);
        assert.equal(decideUnitCoverageScope(['docs/later.md']).run, false);
    }
);

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
