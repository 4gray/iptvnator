/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
    createXtreamBenchmarkSummary,
    persistThenValidateXtreamIteration,
} from './xtream-benchmark-report';
import { MANIFEST, TOKEN, sha256 } from './xtream-benchmark-report.fixtures';
import {
    clearXtreamProvenanceFixtureDirectories,
    smokeReportFixture,
} from './xtream-benchmark-report-provenance.fixtures';
import { toXtreamRawIteration } from './xtream-exact-schema';
import type {
    XtreamRawIterationResult,
    XtreamValidatedIterationResult,
} from './xtream-summary-contract';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all([
        ...directories
            .splice(0)
            .map((directory) =>
                rm(directory, { force: true, recursive: true })
            ),
        clearXtreamProvenanceFixtureDirectories(),
    ]);
});

test('rejects a schedule whose validated raw iterations reuse one persistence path', async () => {
    const { diagnosticEvidence, iterations } = await smokeReportFixture();
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-xtream-shared-raw-path-')
    );
    directories.push(directory);
    const absolutePath = join(directory, 'raw.json');
    const first = await persistAt(
        toXtreamRawIteration(required(iterations, 0)),
        absolutePath
    );
    const second = await persistAt(
        toXtreamRawIteration(required(iterations, 1)),
        absolutePath
    );
    const reused = [...iterations];
    reused[0] = first;
    reused[1] = second;

    assert.equal(first.persistence.pathSha256, second.persistence.pathSha256);
    assert.throws(
        () =>
            createXtreamBenchmarkSummary(
                { ...MANIFEST, mode: 'smoke' },
                reused,
                diagnosticEvidence
            ),
        /persistence path/
    );
});

async function persistAt(
    raw: XtreamRawIterationResult,
    absolutePath: string
): Promise<XtreamValidatedIterationResult> {
    return persistThenValidateXtreamIteration(
        raw,
        {
            controlToken: TOKEN,
            syntheticCredentials: {
                password: 'performance',
                username: 'performance',
            },
        },
        async (serialized) => {
            await writeFile(absolutePath, serialized);
            return {
                absolutePath,
                bytes: Buffer.byteLength(serialized),
                sha256: sha256(serialized),
            };
        }
    );
}

function required<T>(items: readonly T[], index: number): T {
    const item = items[index];
    assert.ok(item);
    return item;
}
