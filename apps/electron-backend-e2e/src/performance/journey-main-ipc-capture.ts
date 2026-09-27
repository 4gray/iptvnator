import type { ElectronApplication } from '@playwright/test';

/**
 * Main-process side of the journey IPC counter.
 *
 * With `IPTVNATOR_TRACE_IPC=1` the preload wraps every bridge method (except
 * `on*` / `remove*` listener registrations) and sends one trace event per
 * invocation on the renderer-API trace channel before forwarding the call
 * (see `apps/electron-backend/src/app/api/main.preload.ts`). This capture
 * subscribes to that channel from the test side and counts `start` events
 * until the renderer probe's sentinel call arrives. Renderer-to-main IPC is
 * delivered in order, so every call started before the sentinel is counted
 * and nothing after it is.
 *
 * A journey that starts inside a running app (J2 "Open a source") passes
 * `startSentinelId`: the probe sends that id before the app handles the
 * start click, calls before it are only tallied in `callsBeforeStart`, and
 * `callsBeforeSentinel` then counts the calls between the two sentinels.
 */

/** Literal of `DEBUG_TRACE_EVENT_CHANNEL` in `services/debug-trace.ts`. */
export const JOURNEY_RENDERER_API_TRACE_CHANNEL = 'IPTVNATOR_DEBUG_TRACE_EVENT';
export const JOURNEY_MAIN_IPC_STATE_KEY = '__iptvnatorJourneyMainIpcCapture';

export interface JourneyMainIpcCaptureOptions {
    readonly channel: string;
    readonly sentinelId: string;
    readonly sentinelMethod: string;
    /** Start marker; absent: counting starts when the capture is installed. */
    readonly startSentinelId?: string;
    readonly stateKey: string;
}

export interface JourneyMainIpcSentinelState {
    readonly occurrences: number;
    readonly receivedEpochMs: number | null;
}

export interface JourneyMainIpcCaptureState {
    readonly callsAfterSentinel: number;
    /** Calls before the start marker; always 0 without one. */
    readonly callsBeforeStart: number;
    /** Calls from the start marker (or install) up to the sentinel. */
    readonly callsBeforeSentinel: number;
    readonly callsByMethod: Record<string, number>;
    readonly installedEpochMs: number;
    readonly malformedEvents: number;
    readonly processStartEpochMs: number;
    readonly senderIds: number[];
    readonly sentinel: JourneyMainIpcSentinelState;
    /** Null when the capture has no start marker. */
    readonly start: JourneyMainIpcSentinelState | null;
}

export async function installJourneyMainIpcCapture(
    electronApp: ElectronApplication,
    options: JourneyMainIpcCaptureOptions
): Promise<void> {
    await electronApp.evaluate(({ ipcMain }, input) => {
        const target = globalThis as unknown as Record<string, unknown>;
        if (target[input.stateKey] !== undefined) {
            throw new Error('journey-main-ipc-capture-already-installed');
        }
        const startSentinelId = input.startSentinelId ?? null;
        const state = {
            callsAfterSentinel: 0,
            callsBeforeStart: 0,
            callsBeforeSentinel: 0,
            callsByMethod: {} as Record<string, number>,
            installedEpochMs: Date.now(),
            malformedEvents: 0,
            processStartEpochMs: Date.now() - process.uptime() * 1000,
            senderIds: [] as number[],
            sentinel: {
                occurrences: 0,
                receivedEpochMs: null as number | null,
            },
            start:
                startSentinelId === null
                    ? null
                    : {
                          occurrences: 0,
                          receivedEpochMs: null as number | null,
                      },
        };
        const carries = (args: unknown, id: string): boolean => {
            try {
                return JSON.stringify(args ?? null).includes(id);
            } catch {
                return false;
            }
        };
        target[input.stateKey] = state;
        ipcMain.on(input.channel, (event, payload: unknown) => {
            const record =
                typeof payload === 'object' && payload !== null
                    ? (payload as Record<string, unknown>)
                    : null;
            if (!record || typeof record['method'] !== 'string') {
                state.malformedEvents += 1;
                return;
            }
            if (record['phase'] !== 'start') {
                return;
            }
            const senderId = event.sender.id;
            if (!state.senderIds.includes(senderId)) {
                state.senderIds.push(senderId);
            }
            const method = record['method'];
            const isMarker = method === input.sentinelMethod;
            if (
                isMarker &&
                state.start !== null &&
                startSentinelId !== null &&
                carries(record['args'], startSentinelId)
            ) {
                state.start.occurrences += 1;
                // A start marker after the sentinel stays unstamped, which
                // the assertion rejects.
                if (state.sentinel.receivedEpochMs === null) {
                    state.start.receivedEpochMs ??= Date.now();
                }
                return;
            }
            if (isMarker && carries(record['args'], input.sentinelId)) {
                state.sentinel.occurrences += 1;
                state.sentinel.receivedEpochMs ??= Date.now();
                return;
            }
            if (state.sentinel.receivedEpochMs !== null) {
                state.callsAfterSentinel += 1;
                return;
            }
            if (state.start !== null && state.start.receivedEpochMs === null) {
                state.callsBeforeStart += 1;
                return;
            }
            state.callsBeforeSentinel += 1;
            state.callsByMethod[method] =
                (state.callsByMethod[method] ?? 0) + 1;
        });
    }, options);
}

/** Raw state without waiting for the sentinel, for settling checks. */
export async function peekJourneyMainIpcCapture(
    electronApp: ElectronApplication,
    stateKey: string
): Promise<JourneyMainIpcCaptureState> {
    const state = (await electronApp.evaluate(
        (_electron, key) =>
            JSON.parse(
                JSON.stringify(
                    (globalThis as unknown as Record<string, unknown>)[key] ??
                        null
                )
            ) as unknown,
        stateKey
    )) as JourneyMainIpcCaptureState | null;
    if (!state) {
        throw new Error('journey-main-ipc-capture-missing');
    }
    return state;
}

export async function readJourneyMainIpcCapture(
    electronApp: ElectronApplication,
    stateKey: string,
    timeoutMs: number
): Promise<JourneyMainIpcCaptureState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const state = await electronApp.evaluate(
            (_electron, key) =>
                JSON.parse(
                    JSON.stringify(
                        (globalThis as unknown as Record<string, unknown>)[key]
                    )
                ) as unknown,
            stateKey
        );
        const capture = state as JourneyMainIpcCaptureState | null;
        if (capture?.sentinel.receivedEpochMs !== null) {
            return assertJourneyMainIpcCapture(capture);
        }
        if (Date.now() >= deadline) {
            throw new Error('journey-main-ipc-capture-sentinel-timeout');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

export function assertJourneyMainIpcCapture(
    value: unknown
): JourneyMainIpcCaptureState {
    const state = value as JourneyMainIpcCaptureState | null | undefined;
    if (!state || typeof state.callsBeforeSentinel !== 'number') {
        throw new Error('journey-main-ipc-capture-missing');
    }
    if (state.sentinel.occurrences !== 1) {
        throw new Error(
            `journey-main-ipc-capture-sentinel-count-${state.sentinel.occurrences}`
        );
    }
    if (state.senderIds.length !== 1) {
        throw new Error(
            `journey-main-ipc-capture-senders-${state.senderIds.length}`
        );
    }
    if (state.malformedEvents > 0) {
        throw new Error('journey-main-ipc-capture-malformed-events');
    }
    if (state.start !== null) {
        if (state.start.occurrences !== 1) {
            throw new Error(
                `journey-main-ipc-capture-start-count-${state.start.occurrences}`
            );
        }
        if (
            state.start.receivedEpochMs === null ||
            state.sentinel.receivedEpochMs === null ||
            state.start.receivedEpochMs > state.sentinel.receivedEpochMs
        ) {
            throw new Error('journey-main-ipc-capture-sentinel-before-start');
        }
    }
    return state;
}
