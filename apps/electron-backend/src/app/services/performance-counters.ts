import type { IpcMain } from 'electron';

/**
 * Named main-process counters for the performance journeys
 * (docs/architecture/performance-journeys.md). Everything here is inert
 * unless `IPTVNATOR_PERF_CAPTURE=1`: nothing is counted, no listener is
 * attached and no IPC handler is registered. Only type imports from
 * `electron`, so the database worker and the preload can load
 * `debug-trace.ts`, which owns the process-wide registry.
 */
export const PERFORMANCE_COUNTERS_READ_CHANNEL = 'performance:read-counters';

export const PERFORMANCE_COUNTER = {
    /** Running total of startup trace phases (`traceStartupPhase`). */
    STARTUP_PHASES: 'main.startupPhases',
    /** Running total of SQL statements run by main and the DB worker. */
    SQL_STATEMENTS: 'main.sqlStatements',
    /** `STARTUP_PHASES` when the first main window was created. */
    MODULES_REGISTERED_BEFORE_WINDOW: 'main.modulesRegisteredBeforeWindow',
    /** `SQL_STATEMENTS` when the first main window emitted `ready-to-show`. */
    SQL_STATEMENTS_BEFORE_READY_TO_SHOW: 'main.sqlStatementsBeforeReadyToShow',
} as const;

export interface PerformanceCountersSnapshot {
    readonly counters: Readonly<Record<string, number>>;
    /** Epoch milliseconds at which each frozen counter was taken. */
    readonly frozenAtEpochMs: Readonly<Record<string, number>>;
}

export interface PerformanceCounterRegistry {
    /** Adds a positive safe integer to a running counter. */
    increment(name: string, by?: number): void;
    /**
     * Copies the current value of `source` into `target` once; later calls
     * keep the first value, so a re-created window cannot move it.
     */
    freeze(source: string, target: string): void;
    read(): PerformanceCountersSnapshot;
}

function sortedRecord(entries: Map<string, number>): Record<string, number> {
    return Object.fromEntries(
        [...entries].sort(([left], [right]) => left.localeCompare(right))
    );
}

export function createPerformanceCounterRegistry(
    isEnabled: () => boolean,
    readEpochMs: () => number = Date.now
): PerformanceCounterRegistry {
    const counters = new Map<string, number>();
    const frozenAtEpochMs = new Map<string, number>();

    return {
        increment(name, by = 1) {
            if (!Number.isSafeInteger(by) || by < 1 || !isEnabled()) {
                return;
            }
            counters.set(name, (counters.get(name) ?? 0) + by);
        },
        freeze(source, target) {
            if (frozenAtEpochMs.has(target) || !isEnabled()) {
                return;
            }
            counters.set(target, counters.get(source) ?? 0);
            frozenAtEpochMs.set(target, readEpochMs());
        },
        read() {
            return {
                counters: sortedRecord(counters),
                frozenAtEpochMs: sortedRecord(frozenAtEpochMs),
            };
        },
    };
}

/**
 * Registers `performance:read-counters` only when capture is enabled. The
 * preload does not expose the channel, so the renderer bridge is unchanged;
 * the journey harness reads it from the main process.
 */
export function registerPerformanceCountersHandler(
    ipcMain: Pick<IpcMain, 'handle'>,
    registry: PerformanceCounterRegistry,
    enabled: boolean
): boolean {
    if (!enabled) {
        return false;
    }
    ipcMain.handle(PERFORMANCE_COUNTERS_READ_CHANNEL, () => registry.read());
    return true;
}

export interface MainWindowPerformanceCounterFlags {
    /** IPTVNATOR_PERF_CAPTURE=1. */
    readonly capture: boolean;
    /** IPTVNATOR_PERF_COUNT_SQL=1 as well; SQL is not counted otherwise. */
    readonly sqlStatements: boolean;
}

/**
 * Freezes the window-relative counters: the startup phases that ran before
 * this window existed and, when SQL is counted, the database statements that
 * ran before its first `ready-to-show`. Without SQL counting no listener is
 * attached, so a zero is never reported for statements nobody counted. Call
 * right after the window is constructed.
 */
export function attachMainWindowPerformanceCounters(
    window: { once(event: 'ready-to-show', listener: () => void): unknown },
    registry: PerformanceCounterRegistry,
    flags: MainWindowPerformanceCounterFlags
): void {
    if (!flags.capture) {
        return;
    }
    registry.freeze(
        PERFORMANCE_COUNTER.STARTUP_PHASES,
        PERFORMANCE_COUNTER.MODULES_REGISTERED_BEFORE_WINDOW
    );
    if (!flags.sqlStatements) {
        return;
    }
    window.once('ready-to-show', () => {
        registry.freeze(
            PERFORMANCE_COUNTER.SQL_STATEMENTS,
            PERFORMANCE_COUNTER.SQL_STATEMENTS_BEFORE_READY_TO_SHOW
        );
    });
}
