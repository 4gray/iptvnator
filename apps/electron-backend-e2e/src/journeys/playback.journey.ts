import { test } from '@playwright/test';

import { startJourneyMockRequestLedger } from '../performance/journey-mock-request-ledger';
import type { JourneyIterationRecord } from '../performance/journey-summary';
import {
    PLAYBACK_JOURNEY_ID,
    PLAYBACK_JOURNEY_UNAVAILABLE_COUNTERS,
    toPlaybackIterationRecord,
} from '../performance/playback-journey-record';
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
    measurePlaybackJourney,
    PLAYBACK_JOURNEY_SEED,
} from './playback-journey-app';

/**
 * J3 "Playback": click on a live channel of an Xtream portal until the
 * built-in HTML5 player's video element fires `playing`. Every iteration is
 * a fresh J1 launch on a copy of the seeded profile (J2's profile with the
 * portal on the mock's local-media `live-fallback` account and the HTML5
 * player selected); the click happens after the app has settled in the
 * portal's first live category.
 * Contract: docs/architecture/performance-journeys.md.
 */
test.describe.configure({ mode: 'serial' });

test('J3 start playback', async () => {
    const ledger = await startJourneyMockRequestLedger(
        LAUNCH_JOURNEY_MOCK_ORIGIN
    );
    const iterations: JourneyIterationRecord[] = [];
    let electronVersion = 'unknown';
    try {
        const templateDirectory = await seedLaunchJourneyProfile(
            ledger.origin,
            PLAYBACK_JOURNEY_SEED
        );
        try {
            const total =
                JOURNEY_WARMUP_ITERATIONS + JOURNEY_MEASURED_ITERATIONS;
            for (let index = 0; index < total; index += 1) {
                const warmup = index < JOURNEY_WARMUP_ITERATIONS;
                const spawnLedgerMark = ledger.mark();
                const { continuation, launch } = await runLaunchJourney(
                    templateDirectory,
                    JOURNEY_ITERATION_TIMEOUT_MS,
                    // Like J2: no main-process counters or SQL hook.
                    { idleWindowMs: null, mainCounters: false },
                    (session) =>
                        measurePlaybackJourney(
                            session,
                            ledger,
                            spawnLedgerMark,
                            JOURNEY_ITERATION_TIMEOUT_MS
                        )
                );
                electronVersion = launch.electronVersion;
                const record = toPlaybackIterationRecord(
                    index,
                    warmup,
                    continuation
                );
                iterations.push(record);
                logJourneyIteration(PLAYBACK_JOURNEY_ID, record);
            }
        } finally {
            await removeLaunchJourneyProfile(templateDirectory);
        }
    } finally {
        await ledger.close();
    }

    await writeJourneyRunEntry(
        PLAYBACK_JOURNEY_ID,
        iterations,
        PLAYBACK_JOURNEY_UNAVAILABLE_COUNTERS,
        electronVersion
    );
});
