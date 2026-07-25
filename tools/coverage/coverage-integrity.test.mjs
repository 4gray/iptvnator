import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
    createCoverageOutputScanner,
    evaluateCoverageRatchets,
    hasRuntimeOwnedStatement,
    validateProjectCoverage,
    validateRequiredProjectReports,
} from './coverage-integrity.mjs';

const temporaryRoots = [];

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function makeProjectFixture({
    name = 'example',
    projectRoot = `libs/${name}`,
    workspaceRoot = undefined,
} = {}) {
    const ownsWorkspace = workspaceRoot === undefined;
    const fixtureRoot =
        workspaceRoot ??
        mkdtempSync(path.join(tmpdir(), 'iptvnator-coverage-integrity-'));
    if (ownsWorkspace) {
        temporaryRoots.push(fixtureRoot);
    }

    const sourceRoot = `${projectRoot}/src`;
    const sourcePath = path.join(fixtureRoot, sourceRoot, 'runtime.ts');
    const reportPath = path.join(
        fixtureRoot,
        'coverage',
        projectRoot,
        'coverage-final.json'
    );

    mkdirSync(path.dirname(sourcePath), { recursive: true });
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(sourcePath, 'export const runtime = true;\n');

    const project = {
        name,
        root: projectRoot,
        sourceRoot,
    };

    return {
        project,
        reportPath,
        sourcePath,
        workspaceRoot: fixtureRoot,
    };
}

function coverageEntry(filePath, hits = [0]) {
    const statementMap = Object.fromEntries(
        hits.map((_, index) => [
            index,
            {
                start: { line: index + 1, column: 0 },
                end: { line: index + 1, column: 28 },
            },
        ])
    );
    const statementHits = Object.fromEntries(
        hits.map((hit, index) => [index, hit])
    );

    return {
        path: filePath,
        statementMap,
        fnMap: {},
        branchMap: {},
        s: statementHits,
        f: {},
        b: {},
    };
}

function functionOnlyCoverageEntry(filePath) {
    return {
        path: filePath,
        statementMap: {},
        fnMap: {
            0: {
                name: 'runtime',
                decl: {
                    start: { line: 1, column: 7 },
                    end: { line: 1, column: 15 },
                },
                loc: {
                    start: { line: 1, column: 7 },
                    end: { line: 1, column: 28 },
                },
                line: 1,
            },
        },
        branchMap: {},
        s: {},
        f: { 0: 1 },
        b: {},
    };
}

function writeCompleteReport(fixture, reportKey = fixture.sourcePath) {
    writeFileSync(
        fixture.reportPath,
        JSON.stringify({
            [reportKey]: coverageEntry(fixture.sourcePath),
        })
    );
}

function fullyCoveredSummary() {
    return {
        statements: { covered: 1, total: 1, pct: 100 },
        branches: { covered: 0, total: 0, pct: 100 },
        functions: { covered: 0, total: 0, pct: 100 },
        lines: { covered: 1, total: 1, pct: 100 },
    };
}

function ratchetWithCriticalFiles(criticalFiles) {
    return {
        merged: {
            statements: 0,
            branches: 0,
            functions: 0,
            lines: 0,
        },
        criticalFiles,
    };
}

describe('hasRuntimeOwnedStatement', () => {
    it('excludes type-only, import-only, and pure re-export source', () => {
        assert.equal(
            hasRuntimeOwnedStatement(
                'import type { Settings } from "./settings";'
            ),
            false
        );
        assert.equal(
            hasRuntimeOwnedStatement(
                'import settings = require("./settings");'
            ),
            false
        );
        assert.equal(
            hasRuntimeOwnedStatement('interface Settings { enabled: boolean }'),
            false
        );
        assert.equal(
            hasRuntimeOwnedStatement('export type Mode = "live" | "vod";'),
            false
        );
        assert.equal(
            hasRuntimeOwnedStatement('export { value } from "./value";'),
            false
        );
        assert.equal(
            hasRuntimeOwnedStatement('declare const injected: string;'),
            false
        );
    });

    it('includes emitted declarations and executable statements', () => {
        assert.equal(
            hasRuntimeOwnedStatement('export const enabled = true;'),
            true
        );
        assert.equal(
            hasRuntimeOwnedStatement(
                'export class RuntimeBoundary { start() {} }'
            ),
            true
        );
        assert.equal(hasRuntimeOwnedStatement('console.log("runtime");'), true);
    });
});

describe('createCoverageOutputScanner', () => {
    it('detects an ANSI-colored marker split across chunks', () => {
        const scanner = createCoverageOutputScanner(128);

        scanner.push('\u001b[31mFailed to collect');
        scanner.push(' coverage from /workspace/effects.ts\u001b[39m');

        assert.equal(scanner.collectionFailed, true);
    });

    it('detects a marker across a split ANSI escape sequence', () => {
        const scanner = createCoverageOutputScanner(128);

        scanner.push('Failed to \u001b[3');
        scanner.push('1mcollect coverage from /workspace/effects.ts');

        assert.equal(scanner.collectionFailed, true);
        assert.equal(scanner.tail.includes('\u001b'), false);
    });

    it('keeps only a bounded rolling tail', () => {
        const scanner = createCoverageOutputScanner(32);

        scanner.push('x'.repeat(256));

        assert.equal(scanner.tail.length, 32);
        assert.equal(scanner.collectionFailed, false);
    });

    it('detects the marker before trimming a long chunk', () => {
        const scanner = createCoverageOutputScanner(32);

        scanner.push(`Failed to collect coverage${'x'.repeat(256)}`);

        assert.equal(scanner.tail.length, 32);
        assert.equal(scanner.collectionFailed, true);
    });
});

describe('validateProjectCoverage', () => {
    it('accepts a report containing every runtime-owning file', () => {
        const fixture = makeProjectFixture();
        const relativeReportKey = path.relative(
            fixture.workspaceRoot,
            fixture.sourcePath
        );
        writeCompleteReport(fixture, relativeReportKey);

        const result = validateProjectCoverage(fixture);

        assert.deepEqual(result.errors, []);
        assert.equal(result.report?.project.name, 'example');
        assert.equal(result.report?.path, fixture.reportPath);
    });

    it('reports a runtime-owning source omitted from a valid report', () => {
        const fixture = makeProjectFixture();
        writeFileSync(fixture.reportPath, '{}');

        const result = validateProjectCoverage(fixture);

        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0], /example/);
        assert.match(result.errors[0], /libs\/example\/src\/runtime\.ts/);
    });

    it('rejects a malformed Istanbul coverage entry', () => {
        const fixture = makeProjectFixture();
        writeFileSync(
            fixture.reportPath,
            JSON.stringify({ [fixture.sourcePath]: {} })
        );

        const result = validateProjectCoverage(fixture);

        assert.equal(result.report, undefined);
        assert.match(
            result.errors[0],
            /example.*coverage\/libs\/example\/coverage-final\.json.*valid Istanbul/
        );
    });

    it('rejects duplicate report paths after normalization', () => {
        const fixture = makeProjectFixture();
        const relativePath = path.relative(
            fixture.workspaceRoot,
            fixture.sourcePath
        );
        writeFileSync(
            fixture.reportPath,
            JSON.stringify({
                [relativePath]: coverageEntry(relativePath),
                [fixture.sourcePath]: coverageEntry(fixture.sourcePath),
            })
        );

        const result = validateProjectCoverage(fixture);

        assert.equal(result.report, undefined);
        assert.equal(result.errors.length, 1);
        assert.match(
            result.errors[0],
            /example.*coverage\/libs\/example\/coverage-final\.json.*duplicate.*libs\/example\/src\/runtime\.ts.*normalization/
        );
    });

    it('rejects a runtime source without usable instrumentation', () => {
        const fixture = makeProjectFixture();
        writeFileSync(
            fixture.reportPath,
            JSON.stringify({
                [fixture.sourcePath]: coverageEntry(fixture.sourcePath, []),
            })
        );

        const result = validateProjectCoverage(fixture);

        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0], /example/);
        assert.match(result.errors[0], /libs\/example\/src\/runtime\.ts/);
        assert.match(result.errors[0], /usable instrumentation/);
    });

    it('accepts function-only instrumentation for a runtime source', () => {
        const fixture = makeProjectFixture();
        writeFileSync(
            fixture.sourcePath,
            'export function runtime() {}\n'
        );
        writeFileSync(
            fixture.reportPath,
            JSON.stringify({
                [fixture.sourcePath]: functionOnlyCoverageEntry(
                    fixture.sourcePath
                ),
            })
        );

        const result = validateProjectCoverage(fixture);

        assert.deepEqual(result.errors, []);
        assert.equal(result.report?.project.name, 'example');
    });

    it('does not require excluded or type-only TypeScript sources', () => {
        const fixture = makeProjectFixture();
        const excludedSources = [
            'feature.spec.ts',
            'feature.test.ts',
            'ambient.d.ts',
            'test-setup.ts',
            'test-stubs/runtime.ts',
            'feature.generated.ts',
            'environments/environment.ts',
            'index.ts',
        ];
        for (const relativePath of excludedSources) {
            const filePath = path.join(
                fixture.workspaceRoot,
                fixture.project.sourceRoot,
                relativePath
            );
            mkdirSync(path.dirname(filePath), { recursive: true });
            writeFileSync(filePath, 'export const omitted = true;\n');
        }
        writeFileSync(
            path.join(
                fixture.workspaceRoot,
                fixture.project.sourceRoot,
                'contract.ts'
            ),
            'export interface Contract { enabled: boolean }\n'
        );
        writeCompleteReport(fixture);

        assert.deepEqual(validateProjectCoverage(fixture).errors, []);
    });

    it('reports missing, malformed, and non-object project reports', () => {
        const missing = makeProjectFixture();
        const malformed = makeProjectFixture();
        const array = makeProjectFixture();
        const nullValue = makeProjectFixture();
        writeFileSync(malformed.reportPath, '{ invalid json');
        writeFileSync(array.reportPath, '[]');
        writeFileSync(nullValue.reportPath, 'null');

        assert.match(
            validateProjectCoverage(missing).errors[0],
            /example.*did not produce.*coverage\/libs\/example\/coverage-final\.json/
        );
        assert.match(
            validateProjectCoverage(malformed).errors[0],
            /example.*invalid JSON/
        );
        assert.match(
            validateProjectCoverage(array).errors[0],
            /example.*JSON object/
        );
        assert.match(
            validateProjectCoverage(nullValue).errors[0],
            /example.*JSON object/
        );
    });

    it('requires every configured report and preserves policy order', () => {
        const first = makeProjectFixture({
            name: 'first',
            projectRoot: 'libs/first',
        });
        const missing = makeProjectFixture({
            name: 'missing',
            projectRoot: 'libs/missing',
            workspaceRoot: first.workspaceRoot,
        });
        const last = makeProjectFixture({
            name: 'last',
            projectRoot: 'libs/last',
            workspaceRoot: first.workspaceRoot,
        });
        writeCompleteReport(first);
        writeCompleteReport(last);

        const result = validateRequiredProjectReports({
            projects: [last.project, missing.project, first.project],
            workspaceRoot: first.workspaceRoot,
        });

        assert.deepEqual(
            result.reports.map((report) => report.project.name),
            ['last', 'first']
        );
        assert.equal(result.errors.length, 1);
        assert.match(result.errors[0], /missing/);
    });
});

describe('evaluateCoverageRatchets', () => {
    it('reports all aggregate percentage regressions', () => {
        const errors = evaluateCoverageRatchets({
            coverageData: {},
            mergedSummary: {
                statements: { covered: 68, total: 100, pct: 68 },
                branches: { covered: 57, total: 100, pct: 57 },
                functions: { covered: 67, total: 100, pct: 67 },
                lines: { covered: 69, total: 100, pct: 69 },
            },
            ratchet: {
                merged: {
                    statements: 68.86,
                    branches: 58.66,
                    functions: 67.19,
                    lines: 69.2,
                },
                criticalFiles: [],
            },
            workspaceRoot: '/workspace',
        });

        assert.deepEqual(errors, [
            'Merged statements coverage regressed: observed 68%, required at least 68.86%.',
            'Merged branches coverage regressed: observed 57%, required at least 58.66%.',
            'Merged functions coverage regressed: observed 67%, required at least 67.19%.',
            'Merged lines coverage regressed: observed 69%, required at least 69.2%.',
        ]);
    });

    it('rejects missing, non-numeric, and out-of-range aggregate minima', () => {
        const errors = evaluateCoverageRatchets({
            coverageData: {},
            mergedSummary: fullyCoveredSummary(),
            ratchet: {
                merged: {
                    branches: '58.66',
                    functions: -1,
                    lines: 101,
                },
                criticalFiles: [],
            },
            workspaceRoot: '/workspace',
        });

        assert.equal(errors.length, 4);
        assert.match(errors[0], /merged\.statements.*undefined/);
        assert.match(errors[1], /merged\.branches.*"58\.66"/);
        assert.match(errors[2], /merged\.functions.*-1/);
        assert.match(errors[3], /merged\.lines.*101/);
    });

    it('accepts an explicitly empty criticalFiles array', () => {
        const errors = evaluateCoverageRatchets({
            coverageData: {},
            mergedSummary: fullyCoveredSummary(),
            ratchet: ratchetWithCriticalFiles([]),
            workspaceRoot: '/workspace',
        });

        assert.deepEqual(errors, []);
    });

    it('requires an explicit criticalFiles array', () => {
        const merged = ratchetWithCriticalFiles([]).merged;
        const ratchets = [
            { merged },
            { merged, criticalFiles: null },
        ];

        for (const ratchet of ratchets) {
            const errors = evaluateCoverageRatchets({
                coverageData: {},
                mergedSummary: fullyCoveredSummary(),
                ratchet,
                workspaceRoot: '/workspace',
            });

            assert.equal(errors.length, 1);
            assert.match(errors[0], /criticalFiles.*array/);
        }
    });

    it('rejects a non-array criticalFiles container without throwing', () => {
        const errors = evaluateCoverageRatchets({
            coverageData: {},
            mergedSummary: fullyCoveredSummary(),
            ratchet: ratchetWithCriticalFiles({}),
            workspaceRoot: '/workspace',
        });

        assert.equal(errors.length, 1);
        assert.match(errors[0], /criticalFiles.*array.*object/);
    });

    it('requires a non-empty string path for every critical file', () => {
        for (const invalidPath of [undefined, null, 42, '', '   ']) {
            const errors = evaluateCoverageRatchets({
                coverageData: {},
                mergedSummary: fullyCoveredSummary(),
                ratchet: ratchetWithCriticalFiles([
                    {
                        path: invalidPath,
                        statements: {
                            minimumCovered: 0,
                            minimumPercent: 0,
                        },
                    },
                ]),
                workspaceRoot: '/workspace',
            });

            assert.equal(errors.length, 1);
            assert.match(errors[0], /criticalFiles\[0\]\.path/);
        }
    });

    it('rejects invalid critical-file statement minima', () => {
        const errors = evaluateCoverageRatchets({
            coverageData: {},
            mergedSummary: fullyCoveredSummary(),
            ratchet: {
                merged: {
                    statements: 0,
                    branches: 0,
                    functions: 0,
                    lines: 0,
                },
                criticalFiles: [
                    {
                        path: 'apps/missing-values.ts',
                        statements: {},
                    },
                    {
                        path: 'apps/string-values.ts',
                        statements: {
                            minimumCovered: '2',
                            minimumPercent: '75',
                        },
                    },
                    {
                        path: 'apps/out-of-range.ts',
                        statements: {
                            minimumCovered: -1,
                            minimumPercent: 101,
                        },
                    },
                    {
                        path: 'apps/fractional.ts',
                        statements: {
                            minimumCovered: 1.5,
                            minimumPercent: 75,
                        },
                    },
                ],
            },
            workspaceRoot: '/workspace',
        });

        assert.equal(errors.length, 7);
        assert.match(
            errors[0],
            /apps\/missing-values\.ts.*minimumCovered.*undefined/
        );
        assert.match(
            errors[1],
            /apps\/missing-values\.ts.*minimumPercent.*undefined/
        );
        assert.match(
            errors[2],
            /apps\/string-values\.ts.*minimumCovered.*"2"/
        );
        assert.match(
            errors[3],
            /apps\/string-values\.ts.*minimumPercent.*"75"/
        );
        assert.match(
            errors[4],
            /apps\/out-of-range\.ts.*minimumCovered.*-1/
        );
        assert.match(
            errors[5],
            /apps\/out-of-range\.ts.*minimumPercent.*101/
        );
        assert.match(
            errors[6],
            /apps\/fractional\.ts.*minimumCovered.*1\.5/
        );
    });

    it('requires both covered statements and percentage for a critical file', () => {
        const workspaceRoot = '/workspace';
        const filePath = path.join(workspaceRoot, 'apps/runtime.ts');
        const errors = evaluateCoverageRatchets({
            coverageData: {
                [filePath]: coverageEntry(filePath, [1, 0]),
            },
            mergedSummary: fullyCoveredSummary(),
            ratchet: {
                merged: {
                    statements: 0,
                    branches: 0,
                    functions: 0,
                    lines: 0,
                },
                criticalFiles: [
                    {
                        path: 'apps/runtime.ts',
                        statements: {
                            minimumCovered: 2,
                            minimumPercent: 75,
                        },
                    },
                ],
            },
            workspaceRoot,
        });

        assert.deepEqual(errors, [
            'Critical coverage apps/runtime.ts statements covered regressed: observed 1, required at least 2.',
            'Critical coverage apps/runtime.ts statements percent regressed: observed 50%, required at least 75%.',
        ]);
    });

    it('looks up a relative Istanbul key by its normalized critical path', () => {
        const workspaceRoot = process.cwd();
        const relativePath = 'apps/runtime.ts';
        const errors = evaluateCoverageRatchets({
            coverageData: {
                [relativePath]: coverageEntry(relativePath, [1, 1]),
            },
            mergedSummary: fullyCoveredSummary(),
            ratchet: {
                merged: {
                    statements: 0,
                    branches: 0,
                    functions: 0,
                    lines: 0,
                },
                criticalFiles: [
                    {
                        path: relativePath,
                        statements: {
                            minimumCovered: 2,
                            minimumPercent: 100,
                        },
                    },
                ],
            },
            workspaceRoot,
        });

        assert.deepEqual(errors, []);
    });

    it('rejects duplicate Istanbul keys after path normalization', () => {
        const workspaceRoot = process.cwd();
        const relativePath = 'apps/runtime.ts';
        const absolutePath = path.join(workspaceRoot, relativePath);
        const errors = evaluateCoverageRatchets({
            coverageData: {
                [relativePath]: coverageEntry(relativePath, [1]),
                [absolutePath]: coverageEntry(absolutePath, [1]),
            },
            mergedSummary: fullyCoveredSummary(),
            ratchet: {
                merged: {
                    statements: 0,
                    branches: 0,
                    functions: 0,
                    lines: 0,
                },
                criticalFiles: [],
            },
            workspaceRoot,
        });

        assert.equal(errors.length, 1);
        assert.match(
            errors[0],
            /duplicate.*apps\/runtime\.ts.*normalization/
        );
    });

    it('reports a critical file missing from merged coverage', () => {
        const errors = evaluateCoverageRatchets({
            coverageData: {},
            mergedSummary: fullyCoveredSummary(),
            ratchet: {
                merged: {
                    statements: 0,
                    branches: 0,
                    functions: 0,
                    lines: 0,
                },
                criticalFiles: [
                    {
                        path: 'apps/missing.ts',
                        statements: {
                            minimumCovered: 1,
                            minimumPercent: 0,
                        },
                    },
                ],
            },
            workspaceRoot: '/workspace',
        });

        assert.deepEqual(errors, [
            'Critical coverage apps/missing.ts is missing from merged coverage.',
        ]);
    });
});
