import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Nx refuses to run a task with `parallelism: false` that depends on a
 * continuous task. `@nx/playwright/plugin` sets `parallelism: false` whenever
 * a config has a webServer no inferred Nx task covers (our mocks and the web
 * backend launch as plain `node` processes), and it infers continuous serve
 * dependencies only from servers with `reuseExistingServer`, which the
 * configs enable only when `CI` is unset. A target graph can therefore pass
 * in CI and still fail locally, so every Playwright target is validated with
 * Nx's own task-graph checks under both environments.
 */
const RESULT_PREFIX = 'e2e-task-graphs-result:';

export const MODES = {
    local: { CI: undefined },
    ci: { CI: 'true' },
};

/**
 * The Playwright projects whose targets must be inferred. The check only sees
 * targets the plugin tags as Playwright ones, so a target that drops out of
 * the inference would otherwise pass unchecked.
 */
export const E2E_PROJECTS = {
    'web-e2e': 'apps/web-e2e',
    'electron-backend-e2e': 'apps/electron-backend-e2e',
};

/** `e2e` plus one atomized target per spec, as the plugin names them. */
export function expectedPlaywrightTargets(specFilesByProject) {
    return Object.entries(specFilesByProject).flatMap(([project, specs]) => [
        `${project}:e2e`,
        ...specs.map((spec) => `${project}:e2e-ci--${spec}`),
    ]);
}

export function findMissingTargets(projectGraph, expectedTargets) {
    const inferred = new Set(
        playwrightTargets(projectGraph).map(
            ({ project, target }) => `${project}:${target}`
        )
    );
    return expectedTargets.filter((task) => !inferred.has(task));
}

function readSpecFiles(workspaceRoot) {
    return Object.fromEntries(
        Object.entries(E2E_PROJECTS).map(([project, root]) => [
            project,
            readdirSync(path.join(workspaceRoot, root, 'src'), {
                recursive: true,
            })
                .filter((file) => file.endsWith('.e2e.ts'))
                .map((file) => `src/${file.split(path.sep).join('/')}`)
                .sort(),
        ])
    );
}

export function playwrightTargets(projectGraph) {
    return Object.values(projectGraph.nodes)
        .flatMap((node) =>
            Object.entries(node.data.targets ?? {})
                .filter(([, target]) =>
                    target.metadata?.technologies?.includes('playwright')
                )
                .map(([target]) => ({ project: node.name, target }))
        )
        .sort((a, b) =>
            `${a.project}:${a.target}`.localeCompare(`${b.project}:${b.target}`)
        );
}

export async function findInvalidTaskGraphs(projectGraph) {
    const { createTaskGraph } =
        await import('nx/src/tasks-runner/create-task-graph.js');
    const { assertTaskGraphDoesNotContainInvalidTargets } =
        await import('nx/src/tasks-runner/task-graph-utils.js');

    return playwrightTargets(projectGraph).flatMap(({ project, target }) => {
        try {
            assertTaskGraphDoesNotContainInvalidTargets(
                createTaskGraph(
                    projectGraph,
                    {},
                    [project],
                    [target],
                    undefined,
                    {}
                )
            );
            return [];
        } catch (error) {
            return [{ task: `${project}:${target}`, message: error.message }];
        }
    });
}

function childEnv(mode) {
    const env = { ...process.env, NX_DAEMON: 'false' };
    for (const [name, value] of Object.entries(MODES[mode])) {
        if (value === undefined) delete env[name];
        else env[name] = value;
    }
    return env;
}

async function checkCurrentEnvironment() {
    const { createProjectGraphAsync, workspaceRoot } =
        await import('@nx/devkit');
    const projectGraph = await createProjectGraphAsync({ exitOnError: true });
    const failures = await findInvalidTaskGraphs(projectGraph);
    const checked = playwrightTargets(projectGraph).length;
    const missing = findMissingTargets(
        projectGraph,
        expectedPlaywrightTargets(readSpecFiles(workspaceRoot))
    );
    console.log(
        `${RESULT_PREFIX}${JSON.stringify({ checked, failures, missing })}`
    );
}

function main() {
    let failed = false;
    for (const mode of Object.keys(MODES)) {
        const output = execFileSync(
            process.execPath,
            [fileURLToPath(import.meta.url), '--current-environment'],
            {
                env: childEnv(mode),
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'inherit'],
            }
        );
        const result = output
            .split('\n')
            .find((line) => line.startsWith(RESULT_PREFIX));
        const { checked, failures, missing } = JSON.parse(
            result.slice(RESULT_PREFIX.length)
        );
        for (const task of missing) {
            failed = true;
            console.error(
                `[${mode}] ${task} was not inferred as a Playwright target`
            );
        }
        for (const { task, message } of failures) {
            failed = true;
            console.error(
                `[${mode}] ${task}\n  ${message.replace(/\n/g, '\n  ')}`
            );
        }
        if (failures.length === 0 && missing.length === 0) {
            console.log(
                `[${mode}] ${checked} Playwright task graphs are valid`
            );
        }
    }
    process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (process.argv.includes('--current-environment')) {
        await checkCurrentEnvironment();
    } else {
        main();
    }
}
