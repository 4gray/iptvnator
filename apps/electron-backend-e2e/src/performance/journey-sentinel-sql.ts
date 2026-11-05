import type { ElectronApplication } from '@playwright/test';

import { JOURNEY_RENDERER_GATE_KEY } from '../journeys/journey-renderer-gate-client';
import {
    JOURNEY_MAIN_COUNTER,
    JOURNEY_PERFORMANCE_COUNTERS_CHANNEL,
} from './journey-main-counters';
import { JOURNEY_RENDERER_API_TRACE_CHANNEL } from './journey-main-ipc-capture';

/**
 * Samples `main.sqlStatements` in the main process when a probe marker
 * arrives on the renderer-API trace channel, the way J4 stamps its start
 * and end sentinels: the gate's `invokeHandler` runs the counters handler
 * synchronously, so the value is the total at the marker's arrival (ordered
 * against the database worker's responses, see "Main-process counters" in
 * docs/architecture/performance-journeys.md) even though it is stored when
 * the promise settles. Installed before the gate releases the document, so
 * no marker can be missed.
 */
export interface JourneySentinelSqlSample {
    readonly epochMs: number;
    readonly sqlStatements: number;
}

export type JourneySentinelSqlState = Record<
    string,
    JourneySentinelSqlSample | null
>;

export interface JourneySentinelSqlOptions {
    /** Sample name → marker id the probe sends with `sentinelMethod`. */
    readonly markers: Readonly<Record<string, string>>;
    readonly sentinelMethod: string;
    readonly stateKey: string;
}

export async function installJourneySentinelSqlSampler(
    electronApp: ElectronApplication,
    options: JourneySentinelSqlOptions
): Promise<void> {
    await electronApp.evaluate(
        ({ ipcMain }, input) => {
            const target = globalThis as unknown as Record<string, unknown>;
            if (target[input.stateKey] !== undefined) {
                throw new Error('journey-sentinel-sql-already-installed');
            }
            const gate = target[input.gateKey] as
                | { invokeHandler?: (channel: string) => Promise<unknown> }
                | undefined;
            if (typeof gate?.invokeHandler !== 'function') {
                throw new Error('journey-sentinel-sql-gate-missing');
            }
            const invokeHandler = gate.invokeHandler;
            const state: Record<
                string,
                { epochMs: number; sqlStatements: number } | null
            > = Object.fromEntries(
                Object.keys(input.markers).map((name) => [name, null])
            );
            target[input.stateKey] = state;
            // Stamped synchronously, so a repeated marker cannot sample
            // again while the first sample's promise is still settling.
            const sampled = new Set<string>();
            ipcMain.on(input.channel, (_event, payload: unknown) => {
                const record = payload as Record<string, unknown> | null;
                if (
                    record?.['method'] !== input.sentinelMethod ||
                    record['phase'] !== 'start'
                ) {
                    return;
                }
                const args = JSON.stringify(record['args'] ?? null);
                const name = Object.keys(input.markers).find((candidate) =>
                    args.includes(input.markers[candidate] as string)
                );
                if (name === undefined || sampled.has(name)) return;
                sampled.add(name);
                const epochMs = Date.now();
                void invokeHandler(input.countersChannel).then((snapshot) => {
                    const value = (
                        snapshot as { counters?: Record<string, number> }
                    )?.counters?.[input.sqlCounter];
                    if (typeof value === 'number') {
                        state[name] = { epochMs, sqlStatements: value };
                    }
                });
            });
        },
        {
            channel: JOURNEY_RENDERER_API_TRACE_CHANNEL,
            countersChannel: JOURNEY_PERFORMANCE_COUNTERS_CHANNEL,
            gateKey: JOURNEY_RENDERER_GATE_KEY,
            markers: options.markers,
            sentinelMethod: options.sentinelMethod,
            sqlCounter: JOURNEY_MAIN_COUNTER.SQL_STATEMENTS,
            stateKey: options.stateKey,
        }
    );
}

/** Waits until every sample is stamped; names the missing ones otherwise. */
export async function readJourneySentinelSql(
    electronApp: ElectronApplication,
    stateKey: string,
    timeoutMs: number
): Promise<JourneySentinelSqlState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const state = (await electronApp.evaluate(
            (_electron, key) =>
                JSON.parse(
                    JSON.stringify(
                        (globalThis as unknown as Record<string, unknown>)[
                            key
                        ] ?? null
                    )
                ) as unknown,
            stateKey
        )) as JourneySentinelSqlState | null;
        if (state === null) {
            throw new Error('journey-sentinel-sql-missing');
        }
        const missing = Object.keys(state).filter(
            (name) => state[name] === null
        );
        if (missing.length === 0) {
            return state;
        }
        if (Date.now() >= deadline) {
            throw new Error(
                `journey-sentinel-sql-not-sampled: ${missing.join(', ')}`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}
