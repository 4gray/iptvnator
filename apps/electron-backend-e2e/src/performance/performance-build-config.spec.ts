/* eslint-disable playwright/expect-expect -- These are Node assertion-based configuration contract tests. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { join } from 'node:path';

import { JOURNEY_CD_TICK_COUNTER_KEY } from './journey-renderer-probe';

interface TargetConfiguration {
    configurations?: Record<string, Record<string, unknown>>;
    dependsOn?: unknown;
    executor?: unknown;
    options?: Record<string, unknown>;
}

interface ProjectConfiguration {
    targets: Record<string, TargetConfiguration>;
}

interface NxGraphTask {
    outputs?: string[];
    target: {
        project: string;
        target: string;
    };
}

interface NxGraph {
    tasks: {
        tasks: Record<string, NxGraphTask>;
    };
}

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function readProject(relativePath: string): ProjectConfiguration {
    return JSON.parse(
        readFileSync(join(workspaceRoot, relativePath), 'utf8')
    ) as ProjectConfiguration;
}

function readResolvedWebBuildTask(): NxGraphTask | undefined {
    const environment = {
        ...process.env,
        FORCE_COLOR: '0',
        NX_DAEMON: 'false',
    };
    delete environment['NO_COLOR'];

    const graph = JSON.parse(
        execFileSync(
            process.execPath,
            [
                join(workspaceRoot, 'node_modules/nx/dist/bin/nx.js'),
                'run',
                'web:build',
                '--graph=stdout',
            ],
            {
                cwd: workspaceRoot,
                encoding: 'utf8',
                env: environment,
            }
        )
    ) as NxGraph;

    return Object.values(graph.tasks.tasks).find(
        (task) =>
            task.target.project === 'web' && task.target.target === 'build'
    );
}

const e2eProject = readProject('apps/electron-backend-e2e/project.json');
const electronProject = readProject('apps/electron-backend/project.json');
const remoteControlProject = readProject(
    'apps/remote-control-web/project.json'
);
const webProject = readProject('apps/web/project.json');

test('the performance harness target runs only Node performance specs', () => {
    const target = e2eProject.targets['test-performance-harness'];

    assert.ok(
        target,
        'electron-backend-e2e must define test-performance-harness'
    );
    assert.equal(target.executor, 'nx:run-commands');
    assert.equal(target.options?.['cwd'], 'apps/electron-backend-e2e');
    assert.equal(
        target.options?.['command'],
        'tsx --test "src/performance/*.spec.ts"'
    );
});

// A nested `pnpm exec` under `pnpm nx` can run from the workspace root instead
// of the target cwd (an older global pnpm with version switching disabled), so
// cwd-relative globs, specs and configs are not found. run-commands already
// puts node_modules/.bin on PATH.
test('electron-backend-e2e command targets call binaries without pnpm exec', () => {
    for (const [name, target] of Object.entries(e2eProject.targets)) {
        const command = target.options?.['command'];
        if (typeof command !== 'string') continue;

        assert.doesNotMatch(command, /\bpnpm exec\b/, name);
    }
});

test('the web performance build keeps production renderer behavior with profiling source maps', () => {
    const build = webProject.targets['build'];
    const production = build.configurations?.['production'];
    const performance = build.configurations?.['electron-performance'];

    assert.ok(production, 'web:build must define production');
    assert.ok(performance, 'web:build must define electron-performance');
    assert.equal(performance['baseHref'], './');
    assert.equal(performance['serviceWorker'], false);
    assert.deepEqual(performance['optimization'], production['optimization']);
    assert.equal(performance['outputHashing'], production['outputHashing']);
    // The only difference is the environment: production values plus the
    // change-detection tick counter the journeys read.
    assert.deepEqual(performance['fileReplacements'], [
        {
            replace: 'apps/web/src/environments/environment.ts',
            with: 'apps/web/src/environments/environment.performance.ts',
        },
    ]);
    assert.deepEqual(production['fileReplacements'], [
        {
            replace: 'apps/web/src/environments/environment.ts',
            with: 'apps/web/src/environments/environment.prod.ts',
        },
    ]);
    assert.equal(performance['sourceMap'], true);
});

test('only the web performance build installs the tick counter the journeys read', () => {
    const environments = join(workspaceRoot, 'apps/web/src/environments');
    const performanceEnvironment = readFileSync(
        join(environments, 'environment.performance.ts'),
        'utf8'
    );
    assert.match(
        performanceEnvironment,
        /export \{ AppConfig \} from '\.\/environment\.prod';/
    );
    assert.match(
        performanceEnvironment,
        /installChangeDetectionTickCounter\(\);/
    );
    assert.match(
        readFileSync(
            join(environments, 'change-detection-tick-counter.ts'),
            'utf8'
        ),
        new RegExp(
            `CHANGE_DETECTION_TICK_COUNTER_KEY = '${JOURNEY_CD_TICK_COUNTER_KEY}'`
        )
    );
    // No other configuration may reference the performance environment.
    for (const [name, configuration] of Object.entries(
        webProject.targets['build'].configurations ?? {}
    )) {
        if (name === 'electron-performance') continue;
        assert.doesNotMatch(
            JSON.stringify(configuration['fileReplacements'] ?? []),
            /environment\.performance/,
            name
        );
    }
});

test('the resolved web build cache output is the renderer directory', () => {
    const task = readResolvedWebBuildTask();

    assert.ok(task, 'the Nx graph must include web:build');
    assert.deepEqual(task.outputs, ['dist/apps/web']);
});

test('the remote-control performance build keeps optimized hashed output with profiling source maps', () => {
    const build = remoteControlProject.targets['build'];
    const production = build.configurations?.['production'];
    const performance = build.configurations?.['electron-performance'];

    assert.ok(production, 'remote-control-web:build must define production');
    assert.ok(
        performance,
        'remote-control-web:build must define electron-performance'
    );
    assert.equal(performance['optimization'], true);
    assert.equal(performance['outputHashing'], production['outputHashing']);
    assert.equal(performance['sourceMap'], true);
});

test('the Electron performance build keeps production main-process behavior with profiling source maps', () => {
    const build = electronProject.targets['build'];
    const production = build.configurations?.['production'];
    const performance = build.configurations?.['electron-performance'];

    assert.ok(production, 'electron-backend:build must define production');
    assert.ok(
        performance,
        'electron-backend:build must define electron-performance'
    );
    assert.equal(performance['optimization'], production['optimization']);
    assert.equal(performance['inspect'], production['inspect']);
    assert.deepEqual(
        performance['fileReplacements'],
        production['fileReplacements']
    );
    assert.equal(performance['sourceMap'], true);
});

test('the regular Electron build keeps its existing renderer dependency contract', () => {
    const build = electronProject.targets['build'];
    const dependencies = build.dependsOn as Array<
        Record<string, unknown> | string
    >;
    const rendererBuild = dependencies.find(
        (dependency): dependency is Record<string, unknown> =>
            typeof dependency === 'object' &&
            dependency !== null &&
            dependency['target'] === 'build'
    );

    assert.deepEqual(rendererBuild, {
        projects: ['web', 'remote-control-web'],
        target: 'build',
    });
});

test('the web performance wrapper selects the profiling configuration', () => {
    const target = webProject.targets['build-performance'];

    assert.ok(target, 'web must define build-performance');
    assert.equal(target.executor, 'nx:run-commands');
    assert.equal(
        target.options?.['command'],
        'pnpm nx run web:build:electron-performance'
    );
});

test('the remote-control performance wrapper selects the profiling configuration', () => {
    const target = remoteControlProject.targets['build-performance'];

    assert.ok(target, 'remote-control-web must define build-performance');
    assert.equal(target.executor, 'nx:run-commands');
    assert.equal(
        target.options?.['command'],
        'pnpm nx run remote-control-web:build:electron-performance'
    );
});

test('the Electron performance wrapper owns build dependencies before its profiled build', () => {
    const target = electronProject.targets['build-performance'];

    assert.ok(target, 'electron-backend must define build-performance');
    assert.equal(target.executor, 'nx:run-commands');
    assert.deepEqual(target.dependsOn, [
        'electron-backend:build-worker-performance',
        'electron-backend:build-embedded-mpv',
        {
            projects: ['web', 'remote-control-web'],
            target: 'build-performance',
        },
    ]);
    assert.equal(
        target.options?.['command'],
        'pnpm nx run electron-backend:build:electron-performance --excludeTaskDependencies'
    );
});

test('the Electron performance wrapper builds optimized source-mapped workers', () => {
    const target = electronProject.targets['build-worker-performance'];
    const source = readFileSync(
        join(workspaceRoot, 'apps/electron-backend/build-worker.js'),
        'utf8'
    );

    assert.ok(target, 'electron-backend must define build-worker-performance');
    assert.equal(target.executor, 'nx:run-commands');
    assert.equal(
        target.options?.['command'],
        'node apps/electron-backend/build-worker.js --performance'
    );
    assert.match(
        source,
        /const isPerformance = process\.argv\.includes\('--performance'\)/
    );
    assert.match(source, /minify: isProduction \|\| isPerformance/);
    assert.match(source, /sourcemap: isPerformance \|\| !isProduction/);
});

test('the cancellation benchmark uses the production-equivalent performance build', () => {
    const target = e2eProject.targets['benchmark-m3u-refresh-cancellation'];

    assert.deepEqual(target.dependsOn, ['electron-backend:build-performance']);
});

test('the cancellation benchmark command is pinned to its Playwright test file', () => {
    const target = e2eProject.targets['benchmark-m3u-refresh-cancellation'];

    assert.equal(
        target.options?.['command'],
        'playwright test --config=playwright.performance.config.ts src/m3u-refresh-cancellation.performance.ts'
    );
});

test('the cancellation benchmark enables preload performance capture', () => {
    const source = readFileSync(
        join(
            workspaceRoot,
            'apps/electron-backend-e2e/src/performance/m3u-refresh-cancellation.benchmark.ts'
        ),
        'utf8'
    );

    assert.match(source, /IPTVNATOR_PERF_CAPTURE:\s*'1'/);
});

test('the cancellation benchmark exposes GC to Electron worker isolates', () => {
    const source = readFileSync(
        join(
            workspaceRoot,
            'apps/electron-backend-e2e/src/performance/m3u-refresh-cancellation.benchmark.ts'
        ),
        'utf8'
    );

    assert.match(source, /'--js-flags=--expose-gc'/);
    assert.doesNotMatch(source, /execArgv/);
});

test('the initial M3U import benchmark uses the production-equivalent performance build', () => {
    const target = e2eProject.targets['benchmark-m3u-import'];

    assert.ok(target, 'electron-backend-e2e must define benchmark-m3u-import');
    assert.deepEqual(target.dependsOn, ['electron-backend:build-performance']);
});

test('the initial M3U import benchmark command is pinned to its Playwright test file', () => {
    const target = e2eProject.targets['benchmark-m3u-import'];

    assert.equal(
        target.options?.['command'],
        'playwright test --config=playwright.performance.config.ts src/m3u-import.performance.ts'
    );
});

test('the initial M3U import benchmark enables opt-in capture and worker GC', () => {
    const source = readFileSync(
        join(
            workspaceRoot,
            'apps/electron-backend-e2e/src/performance/m3u-import.benchmark.ts'
        ),
        'utf8'
    );

    assert.match(source, /IPTVNATOR_PERF_CAPTURE:\s*'1'/);
    assert.match(source, /IPTVNATOR_PERF_WORKER_PROFILING:\s*'1'/);
    assert.match(source, /'--js-flags=--expose-gc'/);
    assert.doesNotMatch(source, /execArgv/);
});
