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

it('keeps separate JUnit failure reports through both Nx executor paths', () => {
    const root = realpathSync(
        mkdtempSync(path.join(tmpdir(), 'iptvnator-junit-'))
    );
    const projects = [
        { name: 'nx-jest', root: 'libs/nx-jest' },
        { name: 'commands', root: 'apps/commands', jestRootMode: 'project' },
    ].map((project) => ({ ...project, sourceRoot: `${project.root}/src` }));
    const writeJson = (file, value) =>
        writeFileSync(path.join(root, file), JSON.stringify(value));

    try {
        symlinkSync(
            path.join(workspaceRoot, 'node_modules'),
            path.join(root, 'node_modules'),
            'junction'
        );
        writeJson('package.json', { name: 'junit-fixture', private: true });
        writeJson('nx.json', {});
        mkdirSync(path.join(root, 'tools/coverage'), { recursive: true });
        writeJson('tools/coverage/coverage-policy.json', {
            unitCoverage: { tierA: projects, tierB: [], tierC: [] },
        });

        for (const project of projects) {
            mkdirSync(path.join(root, project.sourceRoot), { recursive: true });
            const jestConfig = `${project.root}/jest.config.cjs`;
            writeFileSync(
                path.join(root, jestConfig),
                `module.exports = ${JSON.stringify({
                    rootDir: project.jestRootMode ? '.' : root,
                    testMatch: [
                        path.join(root, project.sourceRoot, '*.spec.ts'),
                    ],
                    transform: {},
                    coverageReporters: ['json', 'json-summary'],
                })};`
            );
            writeFileSync(
                path.join(root, project.sourceRoot, 'failure.spec.ts'),
                "test('reportable failure', () => expect(1).toBe(2));\n"
            );
            writeJson(`${project.root}/project.json`, {
                name: project.name,
                targets: {
                    test: project.jestRootMode
                        ? {
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
                          }
                        : {
                              executor: '@nx/jest:jest',
                              options: { jestConfig },
                              configurations: { ci: { ci: true } },
                          },
                },
            });
        }

        const result = spawnSync(
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
                path.join(project.sourceRoot, 'failure.spec.ts')
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
