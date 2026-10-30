import { test } from '@playwright/test';

import type { JourneyIterationRecord } from '../performance/journey-summary';
import {
    SEARCH_JOURNEY_ID,
    SEARCH_JOURNEY_UNAVAILABLE_COUNTERS,
    toSearchIterationRecord,
} from '../performance/search-journey-record';
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
import {
    measureSearchJourney,
    SEARCH_JOURNEY_SEED,
} from './search-journey-app';

/**
 * J4 "Search": type a six-character query into the header search box on
 * /workspace/search until the global search results have settled. Every
 * iteration is a fresh J1 launch on a copy of the seeded profile (one M3U
 * source and the mock's 12,000-item `large` Xtream catalog), with the
 * main-process counters on so SQL statements are counted.
 * Contract: docs/architecture/performance-journeys.md.
 */
test.describe.configure({ mode: 'serial' });

test('J4 search', async () => {
    const iterations: JourneyIterationRecord[] = [];
    let electronVersion = 'unknown';
    const templateDirectory = await seedLaunchJourneyProfile(
        LAUNCH_JOURNEY_MOCK_ORIGIN,
        SEARCH_JOURNEY_SEED
    );
    try {
        const total = JOURNEY_WARMUP_ITERATIONS + JOURNEY_MEASURED_ITERATIONS;
        for (let index = 0; index < total; index += 1) {
            const warmup = index < JOURNEY_WARMUP_ITERATIONS;
            const { continuation, launch } = await runLaunchJourney(
                templateDirectory,
                JOURNEY_ITERATION_TIMEOUT_MS,
                // SQL statements are a J4 counter, so unlike J2 and J3 the
                // launch runs with the main-process counters and SQL hook.
                { idleWindowMs: null, mainCounters: true },
                (session) =>
                    measureSearchJourney(
                        session,
                        JOURNEY_ITERATION_TIMEOUT_MS
                    ).catch((failure: unknown) => {
                        throw new Error(
                            `iteration ${index}: ${String(failure)}`
                        );
                    })
            );
            electronVersion = launch.electronVersion;
            const record = toSearchIterationRecord(index, warmup, continuation);
            iterations.push(record);
            logJourneyIteration(SEARCH_JOURNEY_ID, record);
        }
    } finally {
        await removeLaunchJourneyProfile(templateDirectory);
    }

    await writeJourneyRunEntry(
        SEARCH_JOURNEY_ID,
        iterations,
        SEARCH_JOURNEY_UNAVAILABLE_COUNTERS,
        electronVersion
    );
});
