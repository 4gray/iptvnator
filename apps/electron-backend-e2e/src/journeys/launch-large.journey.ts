import { test } from '@playwright/test';

import type { JourneyIterationRecord } from '../performance/journey-summary';
import {
    LAUNCH_LARGE_JOURNEY_ID,
    LAUNCH_LARGE_JOURNEY_UNAVAILABLE_COUNTERS,
    toLaunchLargeIterationRecord,
} from '../performance/launch-large-journey-record';
import {
    JOURNEY_MEASURED_ITERATIONS,
    JOURNEY_WARMUP_ITERATIONS,
    logJourneyIteration,
    writeJourneyRunEntry,
} from './journey-run';
import {
    isLaunchLargeJourneyEnabled,
    LAUNCH_LARGE_JOURNEY_ENV,
    measureLaunchLargeJourney,
    removeLaunchLargeTemplate,
    seedLaunchLargeTemplate,
} from './launch-large-journey-app';

/**
 * J1 "Launch to usable" on the large-library profile: the same journey as
 * `launch.journey.ts` (spawn until the first source card) on a database of
 * 182 sources and a few million catalog rows, followed by the "dashboard
 * rails settled" phase. Off unless `IPTVNATOR_JOURNEY_LARGE_LIBRARY=1`
 * (the `journeys-large-library` target sets it); see the journeys document
 * for why it runs weekly rather than on every pull request.
 */
test.describe.configure({ mode: 'serial' });

test('J1 launch to usable on a large library', async () => {
    test.skip(
        !isLaunchLargeJourneyEnabled(),
        `set ${LAUNCH_LARGE_JOURNEY_ENV}=1 to run the large-library launch`
    );
    const seed = await seedLaunchLargeTemplate();
    console.log(
        `[journey:${LAUNCH_LARGE_JOURNEY_ID}] profile ${seed.profile.cacheKey} ${seed.profile.cached ? 'cached' : 'generated'} ${JSON.stringify(
            {
                counts: seed.profile.manifest.counts,
                databaseBytes: seed.profile.manifest.databaseBytes,
                generationMs: seed.profile.manifest.generationMs,
                seedLaunch: seed.seedLaunch,
            }
        )}`
    );
    const iterations: JourneyIterationRecord[] = [];
    let electronVersion = 'unknown';
    try {
        const total = JOURNEY_WARMUP_ITERATIONS + JOURNEY_MEASURED_ITERATIONS;
        for (let index = 0; index < total; index += 1) {
            const warmup = index < JOURNEY_WARMUP_ITERATIONS;
            const measurement = await measureLaunchLargeJourney(
                seed.templateDirectory
            );
            electronVersion = measurement.electronVersion;
            const record = toLaunchLargeIterationRecord(
                index,
                warmup,
                measurement
            );
            iterations.push(
                index === 0 ? withProfileEvidence(record, seed) : record
            );
            logJourneyIteration(LAUNCH_LARGE_JOURNEY_ID, record);
        }
    } finally {
        await removeLaunchLargeTemplate(seed.templateDirectory);
    }

    await writeJourneyRunEntry(
        LAUNCH_LARGE_JOURNEY_ID,
        iterations,
        LAUNCH_LARGE_JOURNEY_UNAVAILABLE_COUNTERS,
        electronVersion
    );
});

/** The profile and its seed launch, kept once with the warm-up iteration. */
function withProfileEvidence(
    record: JourneyIterationRecord,
    seed: Awaited<ReturnType<typeof seedLaunchLargeTemplate>>
): JourneyIterationRecord {
    return Object.freeze({
        ...record,
        evidence: Object.freeze({
            ...record.evidence,
            profile: Object.freeze({
                cacheKey: seed.profile.cacheKey,
                cached: seed.profile.cached,
                counts: seed.profile.manifest.counts,
                databaseBytes: seed.profile.manifest.databaseBytes,
                generationMs: seed.profile.manifest.generationMs,
                seedLaunch: seed.seedLaunch,
                spec: seed.profile.manifest.spec,
                sqlite: seed.profile.manifest.sqlite,
            }),
        }),
    });
}
