import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    expectedPlaywrightTargets,
    findInvalidTaskGraphs,
    findMissingTargets,
    MODES,
    playwrightTargets,
} from './check-e2e-task-graphs.mjs';

const playwright = { technologies: ['playwright'] };

/**
 * Mirrors web-e2e as the Playwright plugin infers it without CI: an uncovered
 * mock webServer makes `e2e` non-parallel while `pnpm nx run web:serve` adds a
 * continuous dependency on the dev server.
 */
function graphWithE2eTarget(e2eTarget) {
    const node = (name, targets) => ({
        name,
        type: 'app',
        data: { root: `apps/${name}`, targets },
    });
    return {
        nodes: {
            web: node('web', {
                serve: {
                    executor: '@angular/build:dev-server',
                    continuous: true,
                },
            }),
            'web-e2e': node('web-e2e', {
                e2e: {
                    executor: 'nx:run-commands',
                    options: { command: 'playwright test' },
                    metadata: playwright,
                    ...e2eTarget,
                },
                lint: {
                    executor: '@nx/eslint:lint',
                    parallelism: false,
                    dependsOn: [{ projects: ['web'], target: 'serve' }],
                },
            }),
        },
        dependencies: { web: [], 'web-e2e': [] },
    };
}

test('checks only Playwright-inferred targets', () => {
    const graph = graphWithE2eTarget({ parallelism: false });

    assert.deepEqual(playwrightTargets(graph), [
        { project: 'web-e2e', target: 'e2e' },
    ]);
});

test('reports a non-parallel e2e target that depends on a continuous serve', async () => {
    const graph = graphWithE2eTarget({
        parallelism: false,
        dependsOn: [{ projects: ['web'], target: 'serve' }],
    });

    const failures = await findInvalidTaskGraphs(graph);

    assert.equal(failures.length, 1);
    assert.equal(failures[0].task, 'web-e2e:e2e');
    assert.match(failures[0].message, /web-e2e:e2e -> web:serve/);
});

test('accepts a non-parallel e2e target whose servers Playwright starts', async () => {
    const graph = graphWithE2eTarget({ parallelism: false, dependsOn: [] });

    assert.deepEqual(await findInvalidTaskGraphs(graph), []);
});

test('validates both the local and the CI plugin inference', () => {
    assert.deepEqual(MODES, { local: { CI: undefined }, ci: { CI: 'true' } });
});

test('expects the e2e target and one atomized target per spec', () => {
    assert.deepEqual(
        expectedPlaywrightTargets({ 'web-e2e': ['src/basic.e2e.ts'] }),
        ['web-e2e:e2e', 'web-e2e:e2e-ci--src/basic.e2e.ts']
    );
});

test('reports expected targets the plugin no longer infers', () => {
    const graph = graphWithE2eTarget({ parallelism: false, dependsOn: [] });

    assert.deepEqual(
        findMissingTargets(graph, [
            'web-e2e:e2e',
            'web-e2e:e2e-ci--src/basic.e2e.ts',
        ]),
        ['web-e2e:e2e-ci--src/basic.e2e.ts']
    );
});
