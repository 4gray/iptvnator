import { test } from '@playwright/test';

import type { JourneyIterationRecord } from '../performance/journey-summary';
import {
    LAUNCH_JOURNEY_ID,
    LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS,
    toLaunchIterationRecord,
} from '../performance/launch-journey-record';
import {
    JOURNEY_ITERATION_TIMEOUT_MS,
    JOURNEY_MEASURED_ITERATIONS,
    JOURNEY_WARMUP_ITERATIONS,
    logJourneyIteration,
    writeJourneyRunEntry,
} from './journey-run';
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
test.describe.configure({ mode: 'serial' });

test('J1 launch to usable', async () => {
    const templateDirectory = await seedLaunchJourneyProfile(
        LAUNCH_JOURNEY_MOCK_ORIGIN
    );
    const iterations: JourneyIterationRecord[] = [];
    let electronVersion = 'unknown';
    try {
        const total = JOURNEY_WARMUP_ITERATIONS + JOURNEY_MEASURED_ITERATIONS;
        for (let index = 0; index < total; index += 1) {
            const warmup = index < JOURNEY_WARMUP_ITERATIONS;
            const measurement = await measureLaunchJourney(
                templateDirectory,
                JOURNEY_ITERATION_TIMEOUT_MS
            );
            electronVersion = measurement.electronVersion;
            const record = toLaunchIterationRecord(index, warmup, measurement);
            iterations.push(record);
            logJourneyIteration(LAUNCH_JOURNEY_ID, record);
        }
    } finally {
        await removeLaunchJourneyProfile(templateDirectory);
    }

    await writeJourneyRunEntry(
        LAUNCH_JOURNEY_ID,
        iterations,
        LAUNCH_JOURNEY_UNAVAILABLE_COUNTERS,
        electronVersion
    );
});
