import type { ElectronApplication } from '@playwright/test';

import type { JourneyIpcTimelineEvent } from './journey-ipc-serial-depth';

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
    /**
     * Completions of a method with calls in flight both inside and outside
     * the timeline; attributed outside. Non-zero means `timeline` may show
     * a call as in flight that already completed.
     */
    readonly ambiguousTimelineCompletions: number;
    readonly callsAfterSentinel: number;
    /** Calls before the start marker; always 0 without one. */
    readonly callsBeforeStart: number;
    /** Calls from the start marker (or install) up to the sentinel. */
    readonly callsBeforeSentinel: number;
    readonly callsByMethod: Record<string, number>;
    /**
     * Bridge calls started but not yet completed, per method. The preload
     * follows every `start` with exactly one `success` or `error` (sync and
     * async results alike), so a capture installed before the document
     * loads sees every pair.
     */
    readonly inFlightByMethod: Record<string, number>;
    readonly installedEpochMs: number;
    readonly malformedEvents: number;
    readonly processStartEpochMs: number;
    readonly senderIds: number[];
    readonly sentinel: JourneyMainIpcSentinelState;
    /** Completions without a start seen by this capture (installed late). */
    readonly unmatchedCompletions: number;
    /** Null when the capture has no start marker. */
    readonly start: JourneyMainIpcSentinelState | null;
    /**
     * Bridge starts and completions in arrival order, from the start marker
     * (or install) until the sentinel, sentinels excluded. Input of
     * `computeJourneyIpcSerialDepth`.
     */
    readonly timeline: JourneyIpcTimelineEvent[];
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
            ambiguousTimelineCompletions: 0,
            callsAfterSentinel: 0,
            callsBeforeStart: 0,
            callsBeforeSentinel: 0,
            callsByMethod: {} as Record<string, number>,
            installedEpochMs: Date.now(),
            malformedEvents: 0,
            processStartEpochMs: Date.now() - process.uptime() * 1000,
            inFlightByMethod: {} as Record<string, number>,
            senderIds: [] as number[],
            timeline: [] as { method: string; phase: 'end' | 'start' }[],
            sentinel: {
                occurrences: 0,
                receivedEpochMs: null as number | null,
            },
            unmatchedCompletions: 0,
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
        // Calls in flight per method, split by whether their start is in
        // the timeline. Completions carry no call id, so only these counts
        // decide whether a completion belongs to the timeline.
        const timelineInFlight: Record<string, number> = {};
        const outsideInFlight: Record<string, number> = {};
        const bump = (
            counts: Record<string, number>,
            method: string,
            delta: number
        ): void => {
            counts[method] = (counts[method] ?? 0) + delta;
        };
        const listener = (
            event: { sender: { id: number } },
            payload: unknown
        ): void => {
            const record =
                typeof payload === 'object' && payload !== null
                    ? (payload as Record<string, unknown>)
                    : null;
            if (!record || typeof record['method'] !== 'string') {
                state.malformedEvents += 1;
                return;
            }
            const phase = record['phase'];
            const counting =
                state.sentinel.receivedEpochMs === null &&
                (state.start === null || state.start.receivedEpochMs !== null);
            if (phase === 'success' || phase === 'error') {
                const method = record['method'];
                const inTimeline = timelineInFlight[method] ?? 0;
                const outside = outsideInFlight[method] ?? 0;
                if (inTimeline > 0 && outside > 0) {
                    // Either call may have completed. Attribute it outside,
                    // so the timeline call stays in flight (excluded from
                    // the depth) rather than ending too early.
                    bump(outsideInFlight, method, -1);
                    state.ambiguousTimelineCompletions += 1;
                } else if (inTimeline > 0) {
                    bump(timelineInFlight, method, -1);
                    if (counting) {
                        state.timeline.push({ method, phase: 'end' });
                    }
                } else if (outside > 0) {
                    // Started before the start marker, or a marker itself.
                    bump(outsideInFlight, method, -1);
                }
                const pending = state.inFlightByMethod[record['method']] ?? 0;
                if (pending === 0) {
                    state.unmatchedCompletions += 1;
                } else if (pending === 1) {
                    delete state.inFlightByMethod[record['method']];
                } else {
                    state.inFlightByMethod[record['method']] = pending - 1;
                }
                return;
            }
            if (phase !== 'start') {
                return;
            }
            // Sentinels included: their completions arrive like any other.
            state.inFlightByMethod[record['method']] =
                (state.inFlightByMethod[record['method']] ?? 0) + 1;
            const senderId = event.sender.id;
            if (!state.senderIds.includes(senderId)) {
                state.senderIds.push(senderId);
            }
            const method = record['method'];
            const isMarker = method === input.sentinelMethod;
            if (!counting || isMarker) {
                // Markers and calls outside the counting window stay out of
                // the timeline; an app call of the marker method moves in
                // below.
                bump(outsideInFlight, method, 1);
            }
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
            if (isMarker) {
                // An app call of the marker method: counted, and moved from
                // outside to the timeline.
                bump(outsideInFlight, method, -1);
            }
            bump(timelineInFlight, method, 1);
            state.timeline.push({ method, phase: 'start' });
            state.callsByMethod[method] =
                (state.callsByMethod[method] ?? 0) + 1;
        };
        ipcMain.on(input.channel, listener);
        // Kept next to the state (which is read as JSON) so the capture can
        // be detached from the same main process later.
        target[`${input.stateKey}:detach`] = () => {
            ipcMain.removeListener(input.channel, listener);
        };
    }, options);
}

/**
 * Removes a capture's listener. J2 detaches J1's capture once it has used it
 * to settle, so the launch listener does not run for every bridge call of
 * the measured click.
 */
export async function detachJourneyMainIpcCapture(
    electronApp: ElectronApplication,
    stateKey: string
): Promise<void> {
    await electronApp.evaluate((_electron, key) => {
        const target = globalThis as unknown as Record<string, unknown>;
        const detach = target[`${key}:detach`];
        if (typeof detach !== 'function') {
            throw new Error('journey-main-ipc-capture-not-attached');
        }
        (detach as () => void)();
        delete target[`${key}:detach`];
    }, stateKey);
}

/** Total of `inFlightByMethod`. */
export function countJourneyMainIpcInFlight(
    state: JourneyMainIpcCaptureState
): number {
    return Object.values(state.inFlightByMethod).reduce(
        (total, count) => total + count,
        0
    );
}

/** Raw state without waiting for the sentinel, for settling checks. */
export async function peekJourneyMainIpcCapture(
    electronApp: ElectronApplication,
    stateKey: string
): Promise<JourneyMainIpcCaptureState> {
    const [state] = await peekJourneyMainIpcCaptures(electronApp, [stateKey]);
    return state as JourneyMainIpcCaptureState;
}

/**
 * Several captures read in one synchronous pass in the main process. No
 * `ipcMain` event can be handled in between, so the states are one coherent
 * snapshot: a call counted by one capture is also pending in the other.
 */
export async function peekJourneyMainIpcCaptures(
    electronApp: ElectronApplication,
    stateKeys: readonly string[]
): Promise<JourneyMainIpcCaptureState[]> {
    const states = (await electronApp.evaluate(
        (_electron, keys) =>
            JSON.parse(
                JSON.stringify(
                    keys.map(
                        (key) =>
                            (globalThis as unknown as Record<string, unknown>)[
                                key
                            ] ?? null
                    )
                )
            ) as unknown,
        [...stateKeys]
    )) as (JourneyMainIpcCaptureState | null)[];
    if (states.some((state) => !state)) {
        throw new Error('journey-main-ipc-capture-missing');
    }
    return states as JourneyMainIpcCaptureState[];
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
