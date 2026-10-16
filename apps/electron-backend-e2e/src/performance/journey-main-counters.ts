import type { ElectronApplication } from '@playwright/test';

import type { JourneyRendererGateState } from '../journeys/journey-renderer-gate-client';

/**
 * Test-side reader for the main-process performance counters
 * (`apps/electron-backend/src/app/services/performance-counters.ts`). The app
 * registers `performance:read-counters` only with IPTVNATOR_PERF_CAPTURE=1
 * and the preload does not expose it, so the journey calls the registered
 * handler from the main process through the gate's `ipcMain.handle` tap
 * (`journey-renderer-gate.cjs`).
 */

/** Literal of `PERFORMANCE_COUNTERS_READ_CHANNEL`. */
export const JOURNEY_PERFORMANCE_COUNTERS_CHANNEL = 'performance:read-counters';

/** Literals of `PERFORMANCE_COUNTER`. */
export const JOURNEY_MAIN_COUNTER = {
    MODULES_REGISTERED_BEFORE_WINDOW: 'main.modulesRegisteredBeforeWindow',
    SQL_STATEMENTS: 'main.sqlStatements',
    SQL_STATEMENTS_BEFORE_READY_TO_SHOW: 'main.sqlStatementsBeforeReadyToShow',
    STARTUP_PHASES: 'main.startupPhases',
} as const;

export interface JourneyMainCountersState {
    readonly counters: Readonly<Record<string, number>>;
    readonly frozenAtEpochMs: Readonly<Record<string, number>>;
}

export async function readJourneyMainCounters(
    electronApp: ElectronApplication,
    gateKey: string
): Promise<unknown> {
    return electronApp.evaluate(
        async (_electron, input) => {
            const gate = (globalThis as unknown as Record<string, unknown>)[
                input.gateKey
            ] as
                | { invokeHandler?: (channel: string) => Promise<unknown> }
                | undefined;
            if (typeof gate?.invokeHandler !== 'function') {
                throw new Error('journey-main-counters-gate-missing');
            }
            const snapshot = await gate.invokeHandler(input.channel);
            return JSON.parse(JSON.stringify(snapshot ?? null)) as unknown;
        },
        { channel: JOURNEY_PERFORMANCE_COUNTERS_CHANNEL, gateKey }
    );
}

function isCountRecord(value: unknown): value is Record<string, number> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value).every(
            (entry) => Number.isSafeInteger(entry) && (entry as number) >= 0
        )
    );
}

function isEpochRecord(value: unknown): value is Record<string, number> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value).every(
            (entry) => typeof entry === 'number' && entry > 0
        )
    );
}

/**
 * Accepts a snapshot only when it proves the ordering its counters claim:
 * the startup phases were frozen when the window was created (before the
 * gate saw its first load), and the SQL count at a `ready-to-show` that came
 * after the gate released the real document.
 */
export function assertJourneyMainCounters(
    value: unknown,
    gate: Pick<JourneyRendererGateState, 'gatedEpochMs' | 'releasedEpochMs'>
): JourneyMainCountersState {
    const snapshot = value as Partial<JourneyMainCountersState> | null;
    if (
        !snapshot ||
        !isCountRecord(snapshot.counters) ||
        !isEpochRecord(snapshot.frozenAtEpochMs)
    ) {
        throw new Error('journey-main-counters-malformed');
    }
    const { counters, frozenAtEpochMs } = snapshot;
    const frozen = [
        JOURNEY_MAIN_COUNTER.MODULES_REGISTERED_BEFORE_WINDOW,
        JOURNEY_MAIN_COUNTER.SQL_STATEMENTS_BEFORE_READY_TO_SHOW,
    ];
    for (const name of frozen) {
        if (
            counters[name] === undefined ||
            frozenAtEpochMs[name] === undefined
        ) {
            throw new Error(`journey-main-counters-not-frozen: ${name}`);
        }
    }
    if (gate.gatedEpochMs === null || gate.releasedEpochMs === null) {
        throw new Error('journey-main-counters-gate-incomplete');
    }
    if (
        frozenAtEpochMs[JOURNEY_MAIN_COUNTER.MODULES_REGISTERED_BEFORE_WINDOW] >
        gate.gatedEpochMs
    ) {
        throw new Error('journey-main-counters-window-after-first-load');
    }
    if (
        frozenAtEpochMs[
            JOURNEY_MAIN_COUNTER.SQL_STATEMENTS_BEFORE_READY_TO_SHOW
        ] < gate.releasedEpochMs
    ) {
        throw new Error('journey-main-counters-ready-to-show-before-release');
    }
    const running: Array<[string, string]> = [
        [
            JOURNEY_MAIN_COUNTER.STARTUP_PHASES,
            JOURNEY_MAIN_COUNTER.MODULES_REGISTERED_BEFORE_WINDOW,
        ],
        [
            JOURNEY_MAIN_COUNTER.SQL_STATEMENTS,
            JOURNEY_MAIN_COUNTER.SQL_STATEMENTS_BEFORE_READY_TO_SHOW,
        ],
    ];
    for (const [total, part] of running) {
        if ((counters[total] ?? 0) < counters[part]) {
            throw new Error(
                `journey-main-counters-total-below-frozen: ${total}`
            );
        }
    }
    return { counters, frozenAtEpochMs };
}
