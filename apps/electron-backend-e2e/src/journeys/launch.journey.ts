import { relative } from 'node:path';

import { test } from '@playwright/test';

import {
    electronMainPath,
    packagedRendererIndexPath,
    workspaceRoot,
} from '../electron-test-fixtures';
import {
    JOURNEY_SUMMARY_SCHEMA_VERSION,
    resolveJourneySummaryPath,
    summarizeJourneyIterations,
    writeJourneySummary,
    type JourneyIterationRecord,
    type JourneySummary,
} from '../performance/journey-summary';
import {
    LAUNCH_JOURNEY_ID,
    LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS,
    toLaunchIterationRecord,
} from '../performance/launch-journey-record';
import {
    LAUNCH_JOURNEY_MOCK_ORIGIN,
    measureLaunchJourney,
    removeLaunchJourneyProfile,
    seedLaunchJourneyProfile,
} from './launch-journey-app';

/**
 * J1 "Launch to usable": Electron process spawn until the first playlist or
 * portal card is visible on /workspace with the inline splash removed.
 * Contract: docs/architecture/performance-journeys.md.
 */
const WARMUP_ITERATIONS = 1;
const MEASURED_ITERATIONS = readPositiveInteger(
    'IPTVNATOR_JOURNEY_MEASURED_ITERATIONS',
    5
);
const ITERATION_TIMEOUT_MS = 120_000;

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

test.describe.configure({ mode: 'serial' });

test('J1 launch to usable', async () => {
    const templateDirectory = await seedLaunchJourneyProfile(
        LAUNCH_JOURNEY_MOCK_ORIGIN
    );
    const iterations: JourneyIterationRecord[] = [];
    let electronVersion = 'unknown';
    try {
        const total = WARMUP_ITERATIONS + MEASURED_ITERATIONS;
        for (let index = 0; index < total; index += 1) {
            const warmup = index < WARMUP_ITERATIONS;
            const measurement = await measureLaunchJourney(
                templateDirectory,
                ITERATION_TIMEOUT_MS
            );
            electronVersion = measurement.electronVersion;
            const record = toLaunchIterationRecord(index, warmup, measurement);
            iterations.push(record);
            console.log(
                `[journey:launch] iteration ${index}${warmup ? ' (warm-up)' : ''} pid=${record.pid} ${JSON.stringify(
                    { ...record.counters, ...record.wallClock }
                )}`
            );
        }
    } finally {
        await removeLaunchJourneyProfile(templateDirectory);
    }

    const entry = summarizeJourneyIterations(
        iterations,
        LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS
    );
    const summary: JourneySummary = {
        generatedAt: new Date().toISOString(),
        harness: {
            arch: process.arch,
            ci: Boolean(process.env['CI']),
            electron: electronVersion,
            electronMain: relative(workspaceRoot, electronMainPath),
            measuredIterations: MEASURED_ITERATIONS,
            node: process.version,
            platform: process.platform,
            rendererIndex: relative(workspaceRoot, packagedRendererIndexPath),
            warmupIterations: WARMUP_ITERATIONS,
        },
        journeys: { [LAUNCH_JOURNEY_ID]: entry },
        schemaVersion: JOURNEY_SUMMARY_SCHEMA_VERSION,
    };
    const summaryPath = resolveJourneySummaryPath(workspaceRoot);
    await writeJourneySummary(summaryPath, summary);
    await test.info().attach('journey-summary', {
        contentType: 'application/json',
        path: summaryPath,
    });
    console.log(
        `[journey:launch] summary ${relative(workspaceRoot, summaryPath)}\n${JSON.stringify(
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
});
