import type { Page } from '@playwright/test';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
    type RendererPerformancePhaseHook,
} from '@iptvnator/shared/logging';

import {
    recordFixedGridRendererHeartbeats,
} from './renderer-heartbeat-fixed-grid';

export const M3U_IMPORT_RENDERER_STATE_KEY =
    '__iptvnatorM3uImportRendererCapture';

export interface M3uImportDialogOptions {
    readonly playlistTitle: string;
    readonly playlistUrl: string;
}

export interface M3uImportRendererProbeMetrics {
    readonly firstChannelVisibleEpochMs: number | null;
    readonly frameGapsMs: readonly number[];
    readonly heartbeatDelaysMs: readonly number[];
    readonly longTasksMs: readonly number[];
    readonly operationStartEpochMs: number;
    readonly performancePhaseEvents: readonly RendererPerformancePhaseEvent[];
    readonly playlistId: string | null;
    readonly routeReadyEpochMs: number | null;
    readonly terminalEpochMs: number | null;
    readonly uiPaintedEpochMs: number | null;
}

export async function prepareM3uImportDialog(
    page: Page,
    options: M3uImportDialogOptions
): Promise<void> {
    await page.getByRole('button', { name: 'Add playlist' }).first().click();
    const dialog = page.locator('mat-dialog-container').last();
    await dialog.waitFor({ state: 'visible' });
    await dialog
        .getByRole('textbox', { name: 'Playlist URL (m3u, m3u8)' })
        .fill(options.playlistUrl);
    await dialog
        .getByRole('textbox', { name: 'Playlist title' })
        .fill(options.playlistTitle);
    const submit = dialog.getByRole('button', { name: 'Add playlist' }).last();
    await submit.waitFor({ state: 'visible' });
    if (await submit.isDisabled()) {
        throw new Error('m3u-import-final-add-disabled');
    }
}

export async function installM3uImportRendererProbe(page: Page): Promise<void> {
    await page.evaluate(
        ({ hookKey, stateKey }) => {
            interface ProbeState {
                firstChannelVisibleEpochMs: number | null;
                frameGapsMs: number[];
                frameRequestId: number;
                heartbeatDelaysMs: number[];
                lastFrameAt: number | null;
                longTaskObserver: PerformanceObserver | null;
                longTasksMs: number[];
                operationStartEpochMs: number;
                operationStartMonotonicMs: number;
                performancePhaseEvents: RendererPerformancePhaseEvent[];
                playlistId: string | null;
                recordFrameGap(timestamp: number): void;
                recordLongTask(entry: PerformanceEntry): void;
                routeReadyEpochMs: number | null;
                terminalEpochMs: number | null;
                uiPaintFrameRequestId: number | null;
                uiPaintedEpochMs: number | null;
            }
            const target = globalThis as unknown as Record<
                PropertyKey,
                unknown
            >;
            const hookSymbol = Symbol.for(hookKey);
            if (
                target[stateKey] !== undefined ||
                target[hookSymbol] !== undefined
            ) {
                throw new Error('m3u-import-renderer-probe-already-installed');
            }
            const epoch = (): number =>
                performance.timeOrigin + performance.now();
            const state: ProbeState = {
                firstChannelVisibleEpochMs: null,
                frameGapsMs: [],
                frameRequestId: 0,
                heartbeatDelaysMs: [],
                lastFrameAt: null,
                longTaskObserver: null,
                longTasksMs: [],
                operationStartEpochMs: 0,
                operationStartMonotonicMs: 0,
                performancePhaseEvents: [],
                playlistId: null,
                recordFrameGap: (timestamp) => {
                    const previousFrameAt = state.lastFrameAt;
                    state.lastFrameAt = timestamp;
                    if (
                        previousFrameAt === null ||
                        state.operationStartEpochMs <= 0 ||
                        state.terminalEpochMs !== null
                    ) {
                        return;
                    }
                    const measuredFrameStart = Math.max(
                        previousFrameAt,
                        state.operationStartMonotonicMs
                    );
                    if (timestamp > measuredFrameStart) {
                        state.frameGapsMs.push(timestamp - measuredFrameStart);
                    }
                },
                recordLongTask: (entry) => {
                    const entryEpochMs =
                        performance.timeOrigin + entry.startTime;
                    const measuredStartEpochMs = Math.max(
                        entryEpochMs,
                        state.operationStartEpochMs
                    );
                    const measuredEndEpochMs = Math.min(
                        entryEpochMs + entry.duration,
                        state.terminalEpochMs ?? Number.POSITIVE_INFINITY
                    );
                    if (
                        state.operationStartEpochMs > 0 &&
                        measuredEndEpochMs > measuredStartEpochMs
                    ) {
                        state.longTasksMs.push(
                            measuredEndEpochMs - measuredStartEpochMs
                        );
                    }
                },
                routeReadyEpochMs: null,
                terminalEpochMs: null,
                uiPaintFrameRequestId: null,
                uiPaintedEpochMs: null,
            };
            const performancePhaseHook: RendererPerformancePhaseHook = (
                event
            ) => {
                state.performancePhaseEvents.push(event);
            };
            target[hookSymbol] = performancePhaseHook;
            const terminalTarget = (): string | null => {
                const route = location.pathname.match(
                    /\/workspace\/playlists\/([^/]+)\/all$/
                );
                if (
                    !route ||
                    !document.querySelector('[data-test-id="channel-item"]')
                ) {
                    return null;
                }
                return route[1] ?? null;
            };
            const inspectTerminal = (): void => {
                if (
                    state.operationStartEpochMs <= 0 ||
                    state.terminalEpochMs !== null
                ) {
                    return;
                }
                const route = location.pathname.match(
                    /\/workspace\/playlists\/([^/]+)\/all$/
                );
                if (!route) {
                    return;
                }
                state.routeReadyEpochMs ??= epoch();
                if (!document.querySelector('[data-test-id="channel-item"]')) {
                    return;
                }
                state.firstChannelVisibleEpochMs ??= epoch();
                if (state.uiPaintFrameRequestId !== null) {
                    return;
                }
                state.uiPaintFrameRequestId = requestAnimationFrame(() => {
                    state.uiPaintFrameRequestId = requestAnimationFrame(
                        (terminalFrameAt) => {
                            state.uiPaintFrameRequestId = null;
                            const playlistId = terminalTarget();
                            if (playlistId === null) {
                                return;
                            }
                            state.recordFrameGap(terminalFrameAt);
                            state.playlistId = playlistId;
                            state.uiPaintedEpochMs = epoch();
                            state.terminalEpochMs = state.uiPaintedEpochMs;
                            cancelAnimationFrame(state.frameRequestId);
                            state.frameRequestId = 0;
                            for (const entry of state.longTaskObserver?.takeRecords() ??
                                []) {
                                state.recordLongTask(entry);
                            }
                            state.longTaskObserver?.disconnect();
                            state.longTaskObserver = null;
                        }
                    );
                });
            };
            const frame = (timestamp: number): void => {
                state.recordFrameGap(timestamp);
                if (state.operationStartEpochMs > 0) {
                    inspectTerminal();
                }
                state.frameRequestId =
                    state.terminalEpochMs === null
                        ? requestAnimationFrame(frame)
                        : 0;
            };
            state.frameRequestId = requestAnimationFrame(frame);
            if (
                typeof PerformanceObserver === 'function' &&
                PerformanceObserver.supportedEntryTypes.includes('longtask')
            ) {
                state.longTaskObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        state.recordLongTask(entry);
                    }
                });
                state.longTaskObserver.observe({ entryTypes: ['longtask'] });
            }
            target[stateKey] = state;
        },
        {
            hookKey: RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
            stateKey: M3U_IMPORT_RENDERER_STATE_KEY,
        }
    );
}

export async function triggerM3uImport(page: Page): Promise<number> {
    return page.evaluate((stateKey) => {
        const target = globalThis as unknown as Record<string, unknown>;
        const state = target[stateKey] as
            | {
                  operationStartEpochMs: number;
                  operationStartMonotonicMs: number;
              }
            | undefined;
        if (!state || state.operationStartEpochMs > 0) {
            throw new Error('m3u-import-renderer-probe-unavailable');
        }
        const dialogs = Array.from(
            document.querySelectorAll('mat-dialog-container')
        );
        const dialog = dialogs.at(-1);
        const button = Array.from(dialog?.querySelectorAll('button') ?? [])
            .reverse()
            .find(
                (candidate) =>
                    candidate.textContent?.trim() === 'Add playlist' &&
                    !candidate.disabled
            );
        if (!(button instanceof HTMLButtonElement)) {
            throw new Error('m3u-import-final-add-unavailable');
        }
        state.operationStartMonotonicMs = performance.now();
        state.operationStartEpochMs =
            performance.timeOrigin + state.operationStartMonotonicMs;
        button.click();
        return state.operationStartEpochMs;
    }, M3U_IMPORT_RENDERER_STATE_KEY);
}

export async function recordM3uImportHeartbeat(
    page: Page,
    deadlineEpochMs: number
): Promise<number> {
    return recordFixedGridRendererHeartbeats(
        page,
        M3U_IMPORT_RENDERER_STATE_KEY,
        deadlineEpochMs,
        'm3u-import-renderer-probe-unavailable'
    );
}

export async function waitForM3uImportTerminal(page: Page): Promise<void> {
    await page
        .waitForFunction(
            (stateKey) => {
                const target = globalThis as unknown as Record<string, unknown>;
                const state = target[stateKey] as
                    { terminalEpochMs: number | null } | undefined;
                return typeof state?.terminalEpochMs === 'number';
            },
            M3U_IMPORT_RENDERER_STATE_KEY,
            { timeout: 120_000 }
        )
        .then(() => undefined);
}

export async function stopM3uImportRendererProbe(
    page: Page
): Promise<M3uImportRendererProbeMetrics> {
    return page.evaluate(
        ({ hookKey, stateKey }) => {
            const target = globalThis as unknown as Record<
                PropertyKey,
                unknown
            >;
            const hookSymbol = Symbol.for(hookKey);
            const state = target[stateKey] as
                | {
                      firstChannelVisibleEpochMs: number | null;
                      frameGapsMs: number[];
                      frameRequestId: number;
                      heartbeatDelaysMs: number[];
                      longTaskObserver: PerformanceObserver | null;
                      longTasksMs: number[];
                      operationStartEpochMs: number;
                      performancePhaseEvents: RendererPerformancePhaseEvent[];
                      playlistId: string | null;
                      recordLongTask(entry: PerformanceEntry): void;
                      routeReadyEpochMs: number | null;
                      terminalEpochMs: number | null;
                      uiPaintFrameRequestId: number | null;
                      uiPaintedEpochMs: number | null;
                  }
                | undefined;
            if (!state) {
                throw new Error('m3u-import-renderer-probe-unavailable');
            }
            cancelAnimationFrame(state.frameRequestId);
            if (state.uiPaintFrameRequestId !== null) {
                cancelAnimationFrame(state.uiPaintFrameRequestId);
            }
            for (const entry of state.longTaskObserver?.takeRecords() ?? []) {
                state.recordLongTask(entry);
            }
            state.longTaskObserver?.disconnect();
            delete target[stateKey];
            delete target[hookSymbol];
            return {
                firstChannelVisibleEpochMs: state.firstChannelVisibleEpochMs,
                frameGapsMs: [...state.frameGapsMs],
                heartbeatDelaysMs: [...state.heartbeatDelaysMs],
                longTasksMs: [...state.longTasksMs],
                operationStartEpochMs: state.operationStartEpochMs,
                performancePhaseEvents: [...state.performancePhaseEvents],
                playlistId: state.playlistId,
                routeReadyEpochMs: state.routeReadyEpochMs,
                terminalEpochMs: state.terminalEpochMs,
                uiPaintedEpochMs: state.uiPaintedEpochMs,
            };
        },
        {
            hookKey: RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
            stateKey: M3U_IMPORT_RENDERER_STATE_KEY,
        }
    );
}
