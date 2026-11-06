import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import { JSDOM } from 'jsdom';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

it('collects coverage and separate JUnit failures for inferred Jest and explicit commands', () => {
    const root = realpathSync(
        mkdtempSync(path.join(tmpdir(), 'iptvnator-junit-'))
    );
    const projects = [
        { name: 'inferred-jest', root: 'libs/inferred-jest' },
        { name: 'commands', root: 'apps/commands', jestRootMode: 'workspace' },
    ].map((project) => ({ ...project, sourceRoot: `${project.root}/src` }));
    const writeJson = (file, value) =>
        writeFileSync(path.join(root, file), JSON.stringify(value));

    try {
        symlinkSync(
            path.join(workspaceRoot, 'node_modules'),
            path.join(root, 'node_modules'),
            'junction'
        );
        writeJson('package.json', {
            name: 'junit-fixture',
            private: true,
            devDependencies: {
                jest: JSON.parse(
                    readFileSync(
                        path.join(
                            workspaceRoot,
                            'node_modules/jest/package.json'
                        ),
                        'utf8'
                    )
                ).version,
            },
        });
        writeJson('nx.json', {
            plugins: [
                {
                    plugin: '@nx/jest/plugin',
                    options: { targetName: 'test' },
                    include: ['libs/inferred-jest/jest.config.cjs'],
                },
            ],
            targetDefaults: {
                test: [
                    {
                        filter: { plugin: '@nx/jest/plugin' },
                        inputs: [
                            'default',
                            '{workspaceRoot}/tools/release/fixture.mjs',
                        ],
                        options: {
                            cwd: '{workspaceRoot}',
                            command: 'jest --config {projectRoot}/jest.config.cjs',
                        },
                    },
                ],
            },
        });
        mkdirSync(path.join(root, 'tools/coverage'), { recursive: true });
        writeJson('tools/coverage/coverage-policy.json', {
            unitCoverage: { tierA: projects, tierB: [], tierC: [] },
            reporting: { mergedCoverageDir: 'coverage/merged' },
            e2eSemanticCoverage: { trackedTags: [] },
        });

        for (const project of projects) {
            mkdirSync(path.join(root, project.sourceRoot), { recursive: true });
            const jestConfig = `${project.root}/jest.config.cjs`;
            writeFileSync(
                path.join(root, jestConfig),
                `module.exports = ${JSON.stringify({
                    rootDir: project.jestRootMode === 'workspace' ? root : '.',
                    testMatch: [
                        path.join(root, project.sourceRoot, '*.spec.ts'),
                    ],
                    transform: {},
                    coverageReporters: ['json', 'json-summary'],
                    coverageDirectory: path.join(
                        root,
                        'coverage',
                        project.root
                    ),
                })};`
            );
            writeFileSync(
                path.join(root, project.sourceRoot, 'runtime.spec.ts'),
                "const { runtime } = require('./runtime.ts'); test('runtime value', () => expect(runtime()).toBe(42));\n"
            );
            writeFileSync(
                path.join(root, project.sourceRoot, 'runtime.ts'),
                'function runtime() { return 42; } module.exports = { runtime };\n'
            );
            const targets =
                project.name === 'commands'
                    ? {
                          test: {
                              executor: 'nx:run-commands',
                              options: {
                                  command: [
                                      process.execPath,
                                      path.join(
                                          workspaceRoot,
                                          'node_modules/jest/bin/jest.js'
                                      ),
                                      '--config',
                                      jestConfig,
                                  ],
                                  forwardAllArgs: true,
                              },
                          },
                      }
                    : {};
            writeJson(`${project.root}/project.json`, {
                name: project.name,
                sourceRoot: project.sourceRoot,
                targets,
            });
        }

        const runCoverage = () =>
            spawnSync(
                process.execPath,
                [
                    path.join(
                        workspaceRoot,
                        'tools/coverage/run-tier-a-coverage.mjs'
                    ),
                    '--concurrency=2',
                    '--max-workers=2',
                ],
                {
                    cwd: root,
                    env: { ...process.env, NX_DAEMON: 'false' },
                    encoding: 'utf8',
                    timeout: 60_000,
                }
            );
        const success = runCoverage();
        assert.equal(success.status, 0, `${success.stdout}\n${success.stderr}`);
        for (const project of projects) {
            const coverage = JSON.parse(
                readFileSync(
                    path.join(
                        root,
                        'coverage',
                        project.root,
                        'coverage-final.json'
                    ),
                    'utf8'
                )
            );
            const entry =
                coverage[path.join(root, project.sourceRoot, 'runtime.ts')];
            assert.ok(entry, `missing ${project.name} source coverage`);
            assert.ok(Object.values(entry.s).some((count) => count > 0));
            const xml = readFileSync(
                path.join(root, 'coverage', project.root, 'junit.xml'),
                'utf8'
            );
            const report = new JSDOM(xml, { contentType: 'text/xml' }).window
                .document;
            assert.equal(
                report.getElementsByTagName('testcase')[0].getAttribute('classname'),
                path.join(project.sourceRoot, 'runtime.spec.ts')
            );
        }
        for (const script of [
            'check-coverage-policy.mjs',
            'coverage-health.mjs',
        ]) {
            const validation = spawnSync(
                process.execPath,
                [path.join(workspaceRoot, 'tools/coverage', script)],
                {
                    cwd: root,
                    encoding: 'utf8',
                    env: { ...process.env, NX_DAEMON: 'false' },
                    timeout: 60_000,
                }
            );
            assert.equal(
                validation.status,
                0,
                `${script}: ${validation.stdout}\n${validation.stderr}`
            );
        }
        const scope = spawnSync(
            process.execPath,
            [
                path.join(
                    workspaceRoot,
                    'tools/coverage/unit-coverage-scope.mjs'
                ),
            ],
            {
                cwd: root,
                input: 'tools/release/fixture.mjs\n',
                encoding: 'utf8',
                env: { ...process.env, NX_DAEMON: 'false' },
                timeout: 60_000,
            }
        );
        assert.equal(scope.status, 0, `${scope.stdout}\n${scope.stderr}`);
        assert.match(scope.stdout, /Tier A unit coverage: run\./);
        for (const project of projects) {
            writeFileSync(
                path.join(root, project.sourceRoot, 'runtime.spec.ts'),
                "test('reportable failure', () => expect(1).toBe(2));\n"
            );
        }
        const result = runCoverage();
        const output = `${result.stdout}\n${result.stderr}`;
        assert.equal(result.status, 1, output);
        for (const project of projects) {
            assert.ok(
                existsSync(
                    path.join(root, 'coverage', project.root, 'junit.xml')
                ),
                output
            );
            const xml = readFileSync(
                path.join(root, 'coverage', project.root, 'junit.xml'),
                'utf8'
            );
            const report = new JSDOM(xml, { contentType: 'text/xml' }).window
                .document;
            assert.equal(report.documentElement.getAttribute('failures'), '1');
            const test = report.getElementsByTagName('testcase')[0];
            assert.equal(
                test.getAttribute('classname'),
                path.join(project.sourceRoot, 'runtime.spec.ts')
            );
            assert.equal(
                test.getAttribute('name').trim(),
                'reportable failure'
            );
            assert.ok(test.hasAttribute('time'));
            assert.match(
                test.getElementsByTagName('failure')[0].textContent,
                /Expected: 2/
            );
        }
        assert.match(output, /--reporters=default --reporters=jest-junit/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
