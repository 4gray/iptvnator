import { relative } from 'node:path';

import { test } from '@playwright/test';

import {
    electronMainPath,
    packagedRendererIndexPath,
    workspaceRoot,
} from '../electron-test-fixtures';
import {
    recordJourneySummaryEntry,
    resolveJourneyRunSummaryPath,
    summarizeJourneyIterations,
    type JourneyIterationRecord,
    type JourneySummaryHarness,
} from '../performance/journey-summary';

/**
 * Run-wide settings and summary output shared by the journey specs.
 * Contract: docs/architecture/performance-journeys.md.
 */
export const JOURNEY_WARMUP_ITERATIONS = 1;
export const JOURNEY_MEASURED_ITERATIONS = readPositiveInteger(
    'IPTVNATOR_JOURNEY_MEASURED_ITERATIONS',
    5
);
export const JOURNEY_ITERATION_TIMEOUT_MS = 120_000;

function readPositiveInteger(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

export function logJourneyIteration(
    journeyId: string,
    record: JourneyIterationRecord
): void {
    console.log(
        `[journey:${journeyId}] iteration ${record.index}${record.warmup ? ' (warm-up)' : ''} pid=${record.pid} ${JSON.stringify(
            { ...record.counters, ...record.wallClock }
        )}`
    );
}

/** Summarizes one journey and adds it to this run's summary file. */
export async function writeJourneyRunEntry(
    journeyId: string,
    iterations: readonly JourneyIterationRecord[],
    unavailable: Readonly<Record<string, string>>,
    electronVersion: string
): Promise<void> {
    const entry = summarizeJourneyIterations(iterations, unavailable);
    const harness: JourneySummaryHarness = {
        arch: process.arch,
        ci: Boolean(process.env['CI']),
        electron: electronVersion,
        electronMain: relative(workspaceRoot, electronMainPath),
        measuredIterations: JOURNEY_MEASURED_ITERATIONS,
        node: process.version,
        platform: process.platform,
        rendererIndex: relative(workspaceRoot, packagedRendererIndexPath),
        warmupIterations: JOURNEY_WARMUP_ITERATIONS,
    };
    const summaryPath = resolveJourneyRunSummaryPath(workspaceRoot);
    await recordJourneySummaryEntry(summaryPath, harness, journeyId, entry);
    await test.info().attach(`journey-summary-${journeyId}`, {
        body: JSON.stringify(entry, null, 2),
        contentType: 'application/json',
    });
    console.log(
        `[journey:${journeyId}] summary ${relative(workspaceRoot, summaryPath)}\n${JSON.stringify(
            {
                counters: entry.counters,
                counterStability: entry.counterStability,
                unavailable: entry.unavailable,
                wallClock: entry.wallClock,
            },
            null,
            2
        )}`
    );
}
