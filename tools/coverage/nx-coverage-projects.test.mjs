import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { buildCoverageNxArgs } from './nx-coverage-projects.mjs';

const workspaceRoot = path.resolve('/synthetic-workspace');
const project = {
    name: 'example',
    root: 'libs/example',
    sourceRoot: 'libs/example/src',
};
const inferred = {
    root: project.root,
    targets: {
        test: {
            executor: 'nx:run-commands',
            metadata: { technologies: ['jest'] },
            options: { command: 'jest', cwd: project.root },
        },
    },
};

test('runs inferred project-root Jest with policy sources and absolute report output', () => {
    const args = buildCoverageNxArgs({
        project,
        resolvedProject: inferred,
        workspaceRoot,
        workers: 2,
    });
    assert.deepEqual(args.slice(0, 6), [
        'nx',
        'run',
        'example:test',
        '--output-style=static',
        '--',
        '--maxWorkers=2',
    ]);
    assert.ok(
        args.includes(
            `--coverageDirectory=${path.join(workspaceRoot, 'coverage', project.root)}`
        )
    );
    assert.ok(args.includes('--collectCoverageFrom=src/**/*.{ts,js,mjs,html}'));
    assert.ok(args.includes('--collectCoverageFrom=!src/**/test-stubs/**'));
    assert.ok(args.includes('--reporters=jest-junit'));
});

test('preserves workspace-root collection for the Angular ESM wrapper', () => {
    const resolvedProject = {
        ...inferred,
        targets: {
            test: {
                executor: 'nx:run-commands',
                options: {
                    command:
                        'node tools/testing/run-web-esm-lib-tests.mjs libs/example/src',
                },
            },
        },
    };
    const args = buildCoverageNxArgs({
        project,
        resolvedProject,
        workspaceRoot,
        workers: 3,
    });
    assert.ok(
        args.includes(
            '--collectCoverageFrom=libs/example/src/**/*.{ts,js,mjs,html}'
        )
    );
    assert.ok(
        args.includes(
            `--coverageDirectory=${path.join(workspaceRoot, 'coverage', project.root)}`
        )
    );
});

test('uses the configured Jest root independently of command cwd and source directory name', () => {
    const args = buildCoverageNxArgs({
        project: {
            ...project,
            sourceRoot: 'libs/example/runtime',
            jestRootMode: 'project',
        },
        resolvedProject: {
            ...inferred,
            targets: {
                test: {
                    executor: 'nx:run-commands',
                    options: {
                        command: 'jest --config libs/example/jest.config.cjs',
                    },
                },
            },
        },
        workspaceRoot,
        workers: 2,
    });
    assert.ok(
        args.includes('--collectCoverageFrom=runtime/**/*.{ts,js,mjs,html}')
    );
});

test('rejects missing targets and unsupported executors before starting coverage', () => {
    for (const resolvedProject of [undefined, { targets: {} }]) {
        assert.throws(
            () =>
                buildCoverageNxArgs({
                    project,
                    resolvedProject,
                    workspaceRoot,
                    workers: 2,
                }),
            /no test target/
        );
    }
    assert.throws(
        () =>
            buildCoverageNxArgs({
                project,
                resolvedProject: {
                    targets: { test: { executor: 'unsupported:test' } },
                },
                workspaceRoot,
                workers: 2,
            }),
        /unsupported test executor/
    );
    assert.throws(
        () =>
            buildCoverageNxArgs({
                project: { ...project, jestRootMode: 'unknown' },
                resolvedProject: inferred,
                workspaceRoot,
                workers: 2,
            }),
        /unsupported jestRootMode/
    );
});
