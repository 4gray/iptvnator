/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';

import {
    assertPerformanceArtifactCapacity,
    MIN_PERFORMANCE_ARTIFACT_FREE_BYTES,
} from './performance-artifact-preflight';

test('checks the nearest existing ancestor using available blocks', async () => {
    const requestedPath = resolve(
        '/workspace/dist/performance/2026-07-26/baseline'
    );
    const checkedPaths: string[] = [];
    const existingAncestor = dirname(dirname(requestedPath));

    const result = await assertPerformanceArtifactCapacity(requestedPath, {
        statfs: async (path) => {
            checkedPaths.push(path);
            if (path !== existingAncestor) {
                throw Object.assign(new Error('missing'), { code: 'ENOENT' });
            }
            return {
                bavail: 4_194_304n,
                bsize: 1_024n,
            };
        },
    });

    assert.deepEqual(checkedPaths, [
        requestedPath,
        dirname(requestedPath),
        existingAncestor,
    ]);
    assert.deepEqual(result, {
        availableBytes: 4_294_967_296n,
        checkedPath: existingAncestor,
        minimumBytes: MIN_PERFORMANCE_ARTIFACT_FREE_BYTES,
    });
});

test('accepts exactly two GiB of available capacity', async () => {
    const result = await assertPerformanceArtifactCapacity('/existing', {
        statfs: async () => ({
            bavail: 2_097_152n,
            bsize: 1_024n,
        }),
    });

    assert.equal(result.availableBytes, MIN_PERFORMANCE_ARTIFACT_FREE_BYTES);
});

test('fails before artifact creation when available capacity is below two GiB', async () => {
    await assert.rejects(
        assertPerformanceArtifactCapacity('/existing', {
            statfs: async () => ({
                bavail: 2_097_151n,
                bsize: 1_024n,
            }),
        }),
        /requires at least 2147483648 available bytes.*2147482624/
    );
});

test('does not substitute free blocks that are unavailable to the process', async () => {
    await assert.rejects(
        assertPerformanceArtifactCapacity('/existing', {
            statfs: async () => ({
                bavail: 1n,
                bfree: 9_999_999_999n,
                bsize: 1_024n,
            }),
        }),
        /performance-artifact-space-insufficient/
    );
});

test('does not hide filesystem errors other than a missing path', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    let calls = 0;

    await assert.rejects(
        assertPerformanceArtifactCapacity('/denied/child', {
            statfs: async () => {
                calls += 1;
                throw denied;
            },
        }),
        denied
    );
    assert.equal(calls, 1);
});

test('the benchmark preflights capacity before creating output directories', () => {
    const source = readFileSync(
        new URL('./m3u-refresh-cancellation.benchmark.ts', import.meta.url),
        'utf8'
    );
    const runIteration = source.slice(
        source.indexOf('async function runIteration('),
        source.indexOf('async function seedPlaylist(')
    );
    const resolveConfiguration = source.slice(
        source.indexOf('async function resolveConfiguration('),
        source.indexOf('function readGitSourceState(')
    );

    for (const [name, section] of [
        ['iteration', runIteration],
        ['variant', resolveConfiguration],
    ] as const) {
        const preflight = section.indexOf(
            'await assertPerformanceArtifactCapacity('
        );
        const createDirectory = section.indexOf('await mkdir(');
        assert.ok(preflight >= 0, `${name} preflight is missing`);
        assert.ok(
            preflight < createDirectory,
            `${name} preflight must run before mkdir`
        );
    }
});
