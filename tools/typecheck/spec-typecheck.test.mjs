import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import {
    discoverSpecTsconfigs,
    filterConfigs,
    formatSummary,
    parseArgs,
    parseTscOutput,
    resolveConcurrency,
    runAll,
} from './spec-typecheck.mjs';

let workDir;
before(async () => {
    workDir = await mkdtemp(path.join(os.tmpdir(), 'spec-typecheck-'));
});
after(async () => {
    await rm(workDir, { recursive: true, force: true });
});

test('discovers spec tsconfigs under the search roots and skips build output', async () => {
    const dirs = [
        'apps/web',
        'libs/a/b',
        'libs/a/node_modules/dep',
        'libs/dist/thing',
        'tools/x',
        'other/y',
    ];
    for (const dir of dirs) {
        await mkdir(path.join(workDir, dir), { recursive: true });
        await writeFile(path.join(workDir, dir, 'tsconfig.spec.json'), '{}');
    }
    await writeFile(path.join(workDir, 'libs/a/b/tsconfig.json'), '{}');

    assert.deepEqual(discoverSpecTsconfigs(workDir), [
        'apps/web/tsconfig.spec.json',
        'libs/a/b/tsconfig.spec.json',
        'tools/x/tsconfig.spec.json',
    ]);
    assert.deepEqual(discoverSpecTsconfigs(workDir, ['missing']), []);
});

test('filters configs by path substring', () => {
    const configs = [
        'apps/web/tsconfig.spec.json',
        'libs/epg/tsconfig.spec.json',
    ];
    assert.deepEqual(filterConfigs(configs, []), configs);
    assert.deepEqual(filterConfigs(configs, ['epg']), [
        'libs/epg/tsconfig.spec.json',
    ]);
    assert.deepEqual(filterConfigs(configs, ['nope']), []);
});

test('counts tsc diagnostics and keeps their continuation lines', () => {
    const output = [
        'libs/x/a.spec.ts(3,5): error TS2322: Type A is not assignable to type B.',
        "  Property 'c' is missing in type 'A'.",
        'libs/x/b.spec.ts(9,1): error TS2304: Cannot find name Foo.',
        'error TS6059: File is not under rootDir.',
        '',
    ].join('\n');
    const parsed = parseTscOutput(output);
    assert.equal(parsed.errorCount, 3);
    assert.equal(parsed.errors.length, 4);
    assert.deepEqual(parseTscOutput(''), { errorCount: 0, errors: [] });
});

test('caps the default concurrency and honours an explicit request', () => {
    assert.equal(resolveConcurrency({ cpuCount: 2 }), 1);
    assert.equal(resolveConcurrency({ cpuCount: 12 }), 4);
    assert.equal(resolveConcurrency({ requested: 7, cpuCount: 2 }), 7);
});

test('parses concurrency from flags or the environment and rejects junk', () => {
    assert.deepEqual(parseArgs(['--concurrency=2', 'epg'], {}), {
        concurrency: 2,
        filters: ['epg'],
    });
    assert.deepEqual(parseArgs([], { SPEC_TYPECHECK_CONCURRENCY: '3' }), {
        concurrency: 3,
        filters: [],
    });
    assert.throws(
        () => parseArgs(['--concurrency=zero'], {}),
        /positive integer/
    );
    assert.throws(() => parseArgs(['--verbose'], {}), /Unknown option/);
});

test('runs every task even after a failure and keeps task order', async () => {
    const order = [];
    const tasks = ['a', 'b', 'c', 'd'].map((name, index) => ({
        name,
        async run() {
            order.push(name);
            await new Promise((resolve) =>
                setTimeout(resolve, 5 * (4 - index))
            );
            return { errorCount: name === 'a' ? 2 : 0, errors: [], status: 0 };
        },
    }));
    const settled = [];
    const results = await runAll(tasks, {
        concurrency: 2,
        onSettled: (result) => settled.push(result.name),
    });

    assert.deepEqual(order, ['a', 'b', 'c', 'd']);
    assert.deepEqual(
        results.map((result) => [result.name, result.errorCount]),
        [
            ['a', 2],
            ['b', 0],
            ['c', 0],
            ['d', 0],
        ]
    );
    assert.equal(settled.length, 4);
    assert.ok(results.every((result) => result.durationMs >= 0));
});

test('turns a thrown task into a failing result', async () => {
    const results = await runAll(
        [
            {
                name: 'boom',
                run: () => Promise.reject(new Error('spawn failed')),
            },
        ],
        { concurrency: 1 }
    );
    assert.equal(results[0].errorCount, 1);
    assert.match(results[0].errors[0], /spawn failed/);
});

test('summarises failures first and reports the totals', () => {
    const summary = formatSummary(
        [
            {
                name: 'apps/web/tsconfig.spec.json',
                errorCount: 0,
                durationMs: 12_000,
            },
            {
                name: 'libs/epg/tsconfig.spec.json',
                errorCount: 3,
                durationMs: 4_000,
            },
        ],
        70_000
    );
    const lines = summary.split('\n');
    assert.match(lines[1], /^libs\/epg\/tsconfig\.spec\.json\s+3\s+4s$/);
    assert.match(lines[2], /^apps\/web\/tsconfig\.spec\.json\s+0\s+12s$/);
    assert.match(
        summary,
        /1 of 2 spec programs failed with 3 error\(s\) \(1m 10s\)/
    );

    const clean = formatSummary(
        [{ name: 'a', errorCount: 0, durationMs: 100 }],
        100
    );
    assert.match(clean, /All 1 spec programs type-check \(0s\)/);
});
