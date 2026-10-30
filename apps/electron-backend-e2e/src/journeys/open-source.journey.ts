import { test } from '@playwright/test';

import { startJourneyMockRequestLedger } from '../performance/journey-mock-request-ledger';
import type { JourneyIterationRecord } from '../performance/journey-summary';
import {
    OPEN_SOURCE_JOURNEY_ID,
    OPEN_SOURCE_JOURNEY_UNAVAILABLE_COUNTERS,
    toOpenSourceIterationRecord,
} from '../performance/open-source-journey-record';
import {
    JOURNEY_ITERATION_TIMEOUT_MS,
    JOURNEY_MEASURED_ITERATIONS,
    JOURNEY_WARMUP_ITERATIONS,
    logJourneyIteration,
    writeJourneyRunEntry,
} from './journey-run';
import {
    LAUNCH_JOURNEY_MOCK_ORIGIN,
    removeLaunchJourneyProfile,
    runLaunchJourney,
    seedLaunchJourneyProfile,
} from './launch-journey-app';
import { measureOpenSourceJourney } from './open-source-journey-app';

/**
 * J2 "Open a source": click on the Xtream portal card on the dashboard until
 * the section's category list and first page of items are painted. Every
 * iteration is a fresh J1 launch on a copy of the seeded profile; the click
 * happens after J1's terminal condition and after the app has settled.
 * The profile is seeded through the mock request ledger, so every request
 * the app sends to the mock is counted.
 * Contract: docs/architecture/performance-journeys.md.
 */
test.describe.configure({ mode: 'serial' });

test('J2 open a source', async () => {
    const ledger = await startJourneyMockRequestLedger(
        LAUNCH_JOURNEY_MOCK_ORIGIN
    );
    const iterations: JourneyIterationRecord[] = [];
    let electronVersion = 'unknown';
    try {
        const templateDirectory = await seedLaunchJourneyProfile(ledger.origin);
        try {
            const total =
                JOURNEY_WARMUP_ITERATIONS + JOURNEY_MEASURED_ITERATIONS;
            for (let index = 0; index < total; index += 1) {
                const warmup = index < JOURNEY_WARMUP_ITERATIONS;
                const spawnLedgerMark = ledger.mark();
                const { continuation, launch } = await runLaunchJourney(
                    templateDirectory,
                    JOURNEY_ITERATION_TIMEOUT_MS,
                    // J2 does not read J1's main-process counters, so their
                    // SQL instrumentation stays off during the click.
                    { idleWindowMs: null, mainCounters: false },
                    (session) =>
                        measureOpenSourceJourney(
                            session,
                            ledger,
                            spawnLedgerMark,
                            JOURNEY_ITERATION_TIMEOUT_MS
                        )
                );
                electronVersion = launch.electronVersion;
                const record = toOpenSourceIterationRecord(
                    index,
                    warmup,
                    continuation
                );
                iterations.push(record);
                logJourneyIteration(OPEN_SOURCE_JOURNEY_ID, record);
            }
        } finally {
            await removeLaunchJourneyProfile(templateDirectory);
        }
    } finally {
        await ledger.close();
    }

    await writeJourneyRunEntry(
        OPEN_SOURCE_JOURNEY_ID,
        iterations,
        OPEN_SOURCE_JOURNEY_UNAVAILABLE_COUNTERS,
        electronVersion
    );
});
