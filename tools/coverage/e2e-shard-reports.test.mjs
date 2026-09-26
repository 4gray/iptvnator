import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';

import {
    describeShardReports,
    findPlaywrightJsonReports,
    loadPlaywrightReports,
    verifyShardReports,
} from './e2e-shard-reports.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolsDir, '../..');
const summaryScript = path.join(toolsDir, 'e2e-semantic-summary.mjs');
const temporaryRoots = [];

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function makeTemporaryDir(prefix) {
    const root = mkdtempSync(path.join(tmpdir(), prefix));
    temporaryRoots.push(root);
    return root;
}

function playwrightReport({ shard, file, titles, status = 'passed' }) {
    return {
        config: { shard },
        suites: [
            {
                file,
                specs: titles.map((title) => ({
                    title,
                    tags: [],
                    tests: [{ results: [{ status }] }],
                })),
            },
        ],
        errors: [],
        stats: {},
    };
}

function writeReport(root, relativeDir, report) {
    const directory = path.join(root, relativeDir);
    mkdirSync(directory, { recursive: true });
    const reportPath = path.join(directory, 'results.json');
    writeFileSync(reportPath, JSON.stringify(report));
    return reportPath;
}

function entry(shard, reportPath = `report-${shard?.current ?? 'single'}.json`) {
    return { path: reportPath, shard, report: {} };
}

describe('findPlaywrightJsonReports', () => {
    it('lists every nested results.json in sorted order', () => {
        const root = makeTemporaryDir('iptvnator-shard-find-');
        const second = writeReport(root, 'b-shard-2/dist/test-results/x', {});
        const first = writeReport(root, 'a-shard-1/dist/test-results/x', {});
        writeFileSync(path.join(root, 'a-shard-1', 'other.json'), '{}');

        assert.deepEqual(findPlaywrightJsonReports(root), [first, second]);
    });

    it('returns nothing for a missing directory or a file path', () => {
        const root = makeTemporaryDir('iptvnator-shard-find-');
        const reportPath = writeReport(root, 'single', {});

        assert.deepEqual(findPlaywrightJsonReports(path.join(root, 'nope')), []);
        assert.deepEqual(findPlaywrightJsonReports(reportPath), []);
    });
});

describe('loadPlaywrightReports', () => {
    it('extracts a shard descriptor and flags malformed ones', () => {
        const root = makeTemporaryDir('iptvnator-shard-load-');
        const sharded = writeReport(root, 'sharded', {
            config: { shard: { current: 2, total: 3 } },
        });
        const unsharded = writeReport(root, 'unsharded', { config: { shard: null } });
        const malformed = writeReport(root, 'malformed', {
            config: { shard: { current: '2', total: 3 } },
        });

        const loaded = loadPlaywrightReports([sharded, unsharded, malformed]);

        assert.deepEqual(loaded[0].shard, { current: 2, total: 3 });
        assert.equal(loaded[0].malformedShard, false);
        assert.equal(loaded[1].shard, null);
        assert.equal(loaded[1].malformedShard, false);
        assert.equal(loaded[2].shard, null);
        assert.equal(loaded[2].malformedShard, true);
    });
});

describe('verifyShardReports', () => {
    it('accepts a single unsharded report', () => {
        assert.deepEqual(verifyShardReports([entry(null)]), { ok: true, problems: [] });
    });

    it('accepts a complete shard set in any order', () => {
        const reports = [
            entry({ current: 3, total: 3 }),
            entry({ current: 1, total: 3 }),
            entry({ current: 2, total: 3 }),
        ];

        assert.deepEqual(verifyShardReports(reports), { ok: true, problems: [] });
    });

    it('rejects a malformed shard descriptor even as the only report', () => {
        const result = verifyShardReports([
            { ...entry(null, 'broken.json'), malformedShard: true },
        ]);

        assert.equal(result.ok, false);
        assert.deepEqual(result.problems, [
            'malformed config.shard descriptor: broken.json',
        ]);
    });

    it('rejects an empty set', () => {
        const result = verifyShardReports([]);

        assert.equal(result.ok, false);
        assert.match(result.problems.join('\n'), /no Playwright JSON reports/);
    });

    it('names missing shards', () => {
        const result = verifyShardReports([
            entry({ current: 1, total: 3 }),
            entry({ current: 3, total: 3 }),
        ]);

        assert.equal(result.ok, false);
        assert.deepEqual(result.problems, ['missing shards: 2/3']);
    });

    it('rejects duplicate shards even when the set looks complete', () => {
        const result = verifyShardReports([
            entry({ current: 1, total: 2 }, 'a.json'),
            entry({ current: 1, total: 2 }, 'b.json'),
            entry({ current: 2, total: 2 }, 'c.json'),
        ]);

        assert.equal(result.ok, false);
        assert.deepEqual(result.problems, ['shard 1/2 appears 2 times: a.json, b.json']);
    });

    it('rejects disagreeing shard totals', () => {
        const result = verifyShardReports([
            entry({ current: 1, total: 2 }),
            entry({ current: 2, total: 3 }),
        ]);

        assert.equal(result.ok, false);
        assert.deepEqual(result.problems, ['shard totals disagree: 2, 3']);
    });

    it('rejects mixed sharded and unsharded reports and repeated unsharded runs', () => {
        const mixed = verifyShardReports([
            entry({ current: 1, total: 1 }),
            entry(null, 'plain.json'),
        ]);
        const repeated = verifyShardReports([entry(null, 'a.json'), entry(null, 'b.json')]);

        assert.equal(mixed.ok, false);
        assert.match(mixed.problems.join('\n'), /mixed sharded and unsharded.*plain\.json/);
        assert.equal(repeated.ok, false);
        assert.match(repeated.problems.join('\n'), /2 unsharded reports.*a\.json, b\.json/);
    });
});

describe('describeShardReports', () => {
    it('labels empty, unsharded and sharded sets', () => {
        assert.equal(describeShardReports([]), 'none');
        assert.equal(describeShardReports([entry(null)]), '1 report (unsharded)');
        assert.equal(
            describeShardReports([
                entry({ current: 2, total: 3 }),
                entry({ current: 1, total: 3 }),
            ]),
            '2/3 shards (1/3, 2/3)'
        );
    });
});

describe('e2e-semantic-summary CLI', () => {
    function makeWorkspace() {
        const root = makeTemporaryDir('iptvnator-e2e-summary-');
        mkdirSync(path.join(root, 'tools/coverage'), { recursive: true });
        copyFileSync(
            path.join(repositoryRoot, 'tools/coverage/coverage-policy.json'),
            path.join(root, 'tools/coverage/coverage-policy.json')
        );
        return root;
    }

    function runSummary(root, args) {
        const stepSummary = path.join(root, 'step-summary.md');
        const result = spawnSync(
            process.execPath,
            [summaryScript, '--project=electron-backend-e2e', ...args],
            { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: stepSummary } }
        );
        return {
            ...result,
            stepSummary: existsSync(stepSummary) ? readFileSync(stepSummary, 'utf8') : '',
            summaryPath: path.join(root, 'coverage/e2e/electron-backend-e2e-semantic-summary.md'),
            jsonPath: path.join(root, 'coverage/e2e/electron-backend-e2e-semantic-summary.json'),
        };
    }

    it('merges a complete shard directory into one summary', () => {
        const root = makeWorkspace();
        const shards = path.join(root, 'shards');
        writeReport(
            shards,
            'electron-ubuntu-1/dist/test-results/electron-backend-e2e',
            playwrightReport({
                shard: { current: 1, total: 3 },
                file: 'src/smoke.e2e.ts',
                titles: ['boots @critical @electron'],
            })
        );
        writeReport(
            shards,
            'electron-ubuntu-2/dist/test-results/electron-backend-e2e',
            playwrightReport({
                shard: { current: 2, total: 3 },
                file: 'src/search.e2e.ts',
                titles: ['finds @search', 'sorts @search'],
                status: 'failed',
            })
        );
        writeReport(
            shards,
            'electron-ubuntu-3/dist/test-results/electron-backend-e2e',
            playwrightReport({
                shard: { current: 3, total: 3 },
                file: 'src/xtream.e2e.ts',
                titles: ['browses @xtream'],
            })
        );

        const result = runSummary(root, ['--input=shards']);

        assert.equal(result.status, 0, result.stderr);
        const markdown = readFileSync(result.summaryPath, 'utf8');
        assert.match(markdown, /Source: Playwright JSON report/);
        assert.match(markdown, /Reports: 3\/3 shards \(1\/3, 2\/3, 3\/3\)/);
        assert.match(markdown, /Total tracked tests: 4/);
        assert.match(markdown, /\| @search \| 2 \|/);
        assert.match(markdown, /\| Workspace search across providers \| @search \| 2 \| failing \|/);
        assert.match(markdown, /\| Electron app starts and renders workspace \| @critical \| 1 \| covered \|/);
        const tests = JSON.parse(readFileSync(result.jsonPath, 'utf8'));
        assert.deepEqual(
            tests.map((test) => test.file).sort(),
            ['src/search.e2e.ts', 'src/search.e2e.ts', 'src/smoke.e2e.ts', 'src/xtream.e2e.ts']
        );
        assert.match(result.stepSummary, /Reports: 3\/3 shards/);
    });

    it('refuses to summarize an incomplete shard set', () => {
        const root = makeWorkspace();
        const shards = path.join(root, 'shards');
        writeReport(
            shards,
            'shard-1',
            playwrightReport({
                shard: { current: 1, total: 3 },
                file: 'src/smoke.e2e.ts',
                titles: ['boots @critical'],
            })
        );
        writeReport(
            shards,
            'shard-3',
            playwrightReport({
                shard: { current: 3, total: 3 },
                file: 'src/xtream.e2e.ts',
                titles: ['browses @xtream'],
            })
        );

        const result = runSummary(root, ['--input=shards']);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /missing shards: 2\/3/);
        assert.match(result.stepSummary, /not written.*missing shards: 2\/3/);
        assert.equal(existsSync(result.summaryPath), false);
    });

    it('refuses an explicit input path that does not exist', () => {
        const root = makeWorkspace();

        const result = runSummary(root, ['--input=dist/e2e-shards']);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /input does not exist/);
        assert.match(result.stepSummary, /not written.*input does not exist/);
        assert.equal(existsSync(result.summaryPath), false);
    });

    it('refuses a single report whose shard descriptor is malformed', () => {
        const root = makeWorkspace();
        writeReport(root, 'shards/one', {
            config: { shard: { current: 'x', total: 3 } },
            suites: [],
        });

        const result = runSummary(root, ['--input=shards']);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /malformed config\.shard descriptor/);
        assert.equal(existsSync(result.summaryPath), false);
    });

    it('refuses a report directory without any results.json', () => {
        const root = makeWorkspace();
        mkdirSync(path.join(root, 'shards/empty'), { recursive: true });

        const result = runSummary(root, ['--input=shards']);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /no Playwright JSON reports/);
        assert.equal(existsSync(result.summaryPath), false);
    });

    it('still accepts a single report file and labels it unsharded', () => {
        const root = makeWorkspace();
        const reportPath = writeReport(
            root,
            'dist/test-results/electron-backend-e2e',
            playwrightReport({
                shard: null,
                file: 'src/smoke.e2e.ts',
                titles: ['boots @critical'],
            })
        );

        const explicit = runSummary(root, [`--input=${reportPath}`]);
        assert.equal(explicit.status, 0, explicit.stderr);
        assert.match(readFileSync(explicit.summaryPath, 'utf8'), /Reports: 1 report \(unsharded\)/);

        const implicit = runSummary(root, []);
        assert.equal(implicit.status, 0, implicit.stderr);
        assert.match(readFileSync(implicit.summaryPath, 'utf8'), /Total tracked tests: 1/);
    });

    it('writes into --output-dir instead of the policy directory', () => {
        const root = makeWorkspace();
        writeReport(
            root,
            'dist/test-results/electron-backend-e2e',
            playwrightReport({
                shard: null,
                file: 'src/smoke.e2e.ts',
                titles: ['boots @critical'],
            })
        );

        const result = runSummary(root, ['--output-dir=coverage/e2e/macos-latest']);

        assert.equal(result.status, 0, result.stderr);
        assert.equal(existsSync(result.summaryPath), false);
        const summaryPath = path.join(
            root,
            'coverage/e2e/macos-latest/electron-backend-e2e-semantic-summary.md'
        );
        assert.match(readFileSync(summaryPath, 'utf8'), /Total tracked tests: 1/);
        assert.match(result.stdout, /Wrote coverage\/e2e\/macos-latest\//);
    });

    it('falls back to the spec source scan when no report exists', () => {
        const root = makeWorkspace();
        mkdirSync(path.join(root, 'apps/electron-backend-e2e/src'), { recursive: true });
        writeFileSync(
            path.join(root, 'apps/electron-backend-e2e/src/smoke.e2e.ts'),
            "test('boots @critical', async () => {});\n"
        );

        const result = runSummary(root, []);

        assert.equal(result.status, 0, result.stderr);
        const markdown = readFileSync(result.summaryPath, 'utf8');
        assert.match(markdown, /Source: spec source scan/);
        assert.match(markdown, /Reports: none/);
        assert.match(markdown, /Statuses: not-run: 1/);
    });
});
