import type { Page } from '@playwright/test';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
    type RendererPerformancePhaseHook,
} from '@iptvnator/shared/logging';

import type { XtreamScenarioId } from './xtream-benchmark-contract';
import {
    XTREAM_RENDERER_STATE_KEY,
    XTREAM_RENDERER_STOPPED_KEY,
    type XtreamRendererDbEvent,
    type XtreamRendererProbeOptions,
} from './xtream-renderer-probe-contract';

export * from './xtream-renderer-probe-contract';

export async function installXtreamRendererProbe(
    page: Page,
    options: XtreamRendererProbeOptions
): Promise<void> {
    await page.evaluate(
        ({ hookKey, scenarioId, sourceTitle, stateKey, stoppedKey }) => {
            interface DbEvent {
                current?: number;
                increment?: number;
                operation?: string;
                operationId?: string;
                phase?: string;
                playlistId?: string;
                status?: string;
                total?: number;
            }
            interface State {
                activeDeleteOperationId: string | null;
                cancelEligibleProgressEpochMs: number | null;
                cancellationClickEpochMs: number | null;
                dbCancellationTerminalEpochMs: number | null;
                dbOperationEvents: XtreamRendererDbEvent[];
                dbUnsubscribe: (() => void) | null;
                domReadyEpochMs: number | null;
                frameGapsMs: number[];
                frameRequestId: number;
                heartbeatDelaysMs: number[];
                invalidReason: string | null;
                lastFrameAt: number | null;
                longTaskObserver: PerformanceObserver | null;
                longTasksMs: number[];
                operationStartEpochMs: number;
                operationStartMonotonicMs: number;
                paintFrameCount: number;
                performancePhaseEvents: RendererPerformancePhaseEvent[];
                recordLongTask(entry: PerformanceEntry): void;
                removeCancelClickListener: (() => void) | null;
                routeReadyEpochMs: number | null;
                saveContentOperationId: string | null;
                scenarioId: XtreamScenarioId;
                sourceTitle: string;
                storeTerminalCount: number;
                storeTerminalEpochMs: number | null;
                terminalEpochMs: number | null;
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
                throw new Error('xtream-renderer-probe-already-installed');
            }
            delete target[stoppedKey];
            const epoch = (): number =>
                performance.timeOrigin + performance.now();
            const numberOrNull = (value: unknown): number | null =>
                typeof value === 'number' &&
                Number.isFinite(value) &&
                value >= 0
                    ? value
                    : null;
            const stringOrNull = (value: unknown): string | null =>
                typeof value === 'string' && value.length > 0 ? value : null;
            const state: State = {
                activeDeleteOperationId: null,
                cancelEligibleProgressEpochMs: null,
                cancellationClickEpochMs: null,
                dbCancellationTerminalEpochMs: null,
                dbOperationEvents: [],
                dbUnsubscribe: null,
                domReadyEpochMs: null,
                frameGapsMs: [],
                frameRequestId: 0,
                heartbeatDelaysMs: [],
                invalidReason: null,
                lastFrameAt: null,
                longTaskObserver: null,
                longTasksMs: [],
                operationStartEpochMs: 0,
                operationStartMonotonicMs: 0,
                paintFrameCount: 0,
                performancePhaseEvents: [],
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
                removeCancelClickListener: null,
                routeReadyEpochMs: null,
                saveContentOperationId: null,
                scenarioId,
                sourceTitle,
                storeTerminalCount: 0,
                storeTerminalEpochMs: null,
                terminalEpochMs: null,
                uiPaintedEpochMs: null,
            };
            const routeHydratesAfterImport =
                scenarioId === 'xtream-refresh-large' ||
                scenarioId === 'xtream-background-ui';
            const requiredStoreTerminalCount = routeHydratesAfterImport ? 2 : 1;
            const isVisible = (element: Element | null): boolean =>
                element instanceof HTMLElement &&
                element.getClientRects().length > 0;
            const catalogVisible = (): boolean =>
                isVisible(
                    document.querySelector(
                        'app-workspace-context-panel .category-item, ' +
                            '.content-card, [data-test-id="channel-item"], mat-card'
                    )
                );
            const overlayGone = (): boolean =>
                !isVisible(
                    document.querySelector('.workspace-loading-overlay')
                );
            const sourceRowAbsent = (): boolean =>
                !Array.from(
                    document.querySelectorAll('app-playlist-item')
                ).some(
                    (row) =>
                        row
                            .querySelector('.playlist-title')
                            ?.textContent?.trim() === state.sourceTitle
                );
            const terminalDomGate = (): boolean => {
                if (
                    state.storeTerminalEpochMs === null ||
                    !overlayGone() ||
                    state.invalidReason !== null
                ) {
                    return false;
                }
                if (scenarioId === 'xtream-cancel-import') {
                    return (
                        location.pathname.includes('/workspace/xtreams/') &&
                        state.dbCancellationTerminalEpochMs !== null &&
                        isVisible(
                            document.querySelector('.xtream-content-gate')
                        )
                    );
                }
                if (scenarioId === 'xtream-delete-large') {
                    return (
                        sourceRowAbsent() &&
                        !location.pathname.includes('/workspace/xtreams/')
                    );
                }
                return (
                    location.pathname.includes('/workspace/xtreams/') &&
                    catalogVisible()
                );
            };
            const phaseHook: RendererPerformancePhaseHook = (event) => {
                state.performancePhaseEvents.push(event);
                const requiredPhase =
                    scenarioId === 'xtream-delete-large'
                        ? 'store.xtream-delete-row'
                        : 'store.xtream-import-terminal';
                if (
                    state.operationStartEpochMs > 0 &&
                    event.boundary === 'end' &&
                    event.outcome === 'success' &&
                    event.phase === requiredPhase
                ) {
                    state.storeTerminalCount += 1;
                    if (
                        state.storeTerminalCount === requiredStoreTerminalCount
                    ) {
                        state.storeTerminalEpochMs = event.epochMs;
                    } else if (
                        state.storeTerminalCount > requiredStoreTerminalCount
                    ) {
                        state.invalidReason ??= 'duplicate-store-terminal';
                    }
                }
            };
            target[hookSymbol] = phaseHook;
            const onDbEvent = (event: DbEvent): void => {
                const sampledEpochMs = epoch();
                const operation = stringOrNull(event.operation);
                const status = stringOrNull(event.status);
                if (operation === null || status === null) {
                    state.invalidReason ??= 'invalid-db-operation-event';
                    return;
                }
                const sanitized: XtreamRendererDbEvent = {
                    current: numberOrNull(event.current),
                    epochMs: sampledEpochMs,
                    increment: numberOrNull(event.increment),
                    operation,
                    operationId: stringOrNull(event.operationId),
                    phase: stringOrNull(event.phase),
                    playlistId: stringOrNull(event.playlistId),
                    status,
                    total: numberOrNull(event.total),
                };
                state.dbOperationEvents.push(sanitized);
                if (operation === 'delete-xtream-content') {
                    if (status === 'started' || status === 'progress') {
                        state.activeDeleteOperationId ??= sanitized.operationId;
                        if (
                            state.activeDeleteOperationId === null ||
                            sanitized.operationId !==
                                state.activeDeleteOperationId
                        ) {
                            state.invalidReason ??=
                                'ambiguous-delete-xtream-content';
                        }
                    } else if (
                        sanitized.operationId ===
                            state.activeDeleteOperationId &&
                        ['cancelled', 'completed', 'error'].includes(status)
                    ) {
                        state.activeDeleteOperationId = null;
                    }
                }
                if (
                    scenarioId !== 'xtream-cancel-import' ||
                    operation !== 'save-content' ||
                    state.operationStartEpochMs <= 0
                ) {
                    return;
                }
                if (status === 'started' || status === 'progress') {
                    state.saveContentOperationId ??= sanitized.operationId;
                    if (
                        state.saveContentOperationId === null ||
                        sanitized.operationId !== state.saveContentOperationId
                    ) {
                        state.invalidReason ??= 'ambiguous-save-content';
                        return;
                    }
                }
                if (
                    state.cancellationClickEpochMs !== null &&
                    (status === 'completed' || status === 'started')
                ) {
                    state.invalidReason ??= 'save-content-after-cancel';
                    return;
                }
                if (status === 'cancelled') {
                    if (
                        sanitized.operationId !== state.saveContentOperationId
                    ) {
                        state.invalidReason ??= 'ambiguous-save-content';
                        return;
                    }
                    state.dbCancellationTerminalEpochMs = sampledEpochMs;
                    return;
                }
                const total = sanitized.total;
                const current = sanitized.current;
                if (
                    status !== 'progress' ||
                    total === null ||
                    current === null ||
                    current < Math.max(100, Math.floor(total * 0.1)) ||
                    state.cancelEligibleProgressEpochMs !== null
                ) {
                    return;
                }
                state.cancelEligibleProgressEpochMs = sampledEpochMs;
            };
            const onCancelClick = (event: Event): void => {
                const clicked = event.target;
                if (
                    scenarioId !== 'xtream-cancel-import' ||
                    !(clicked instanceof Element) ||
                    clicked.closest('.workspace-loading-overlay__action') ===
                        null
                ) {
                    return;
                }
                if (
                    state.operationStartEpochMs <= 0 ||
                    state.cancelEligibleProgressEpochMs === null
                ) {
                    state.invalidReason ??= 'cancel-click-before-progress';
                    return;
                }
                if (state.cancellationClickEpochMs !== null) {
                    state.invalidReason ??= 'duplicate-cancel-click';
                    return;
                }
                state.cancellationClickEpochMs = epoch();
            };
            document.addEventListener('click', onCancelClick, true);
            state.removeCancelClickListener = () =>
                document.removeEventListener('click', onCancelClick, true);
            const bridge = (
                globalThis as unknown as {
                    electron?: {
                        onDbOperationEvent?: (
                            listener: (event: DbEvent) => void
                        ) => () => void;
                    };
                }
            ).electron;
            if (typeof bridge?.onDbOperationEvent !== 'function') {
                throw new Error('xtream-db-operation-listener-unavailable');
            }
            state.dbUnsubscribe = bridge.onDbOperationEvent(onDbEvent);
            const frame = (timestamp: number): void => {
                if (
                    state.lastFrameAt !== null &&
                    state.operationStartEpochMs > 0 &&
                    state.terminalEpochMs === null
                ) {
                    const start = Math.max(
                        state.lastFrameAt,
                        state.operationStartMonotonicMs
                    );
                    if (timestamp > start)
                        state.frameGapsMs.push(timestamp - start);
                }
                state.lastFrameAt = timestamp;
                const routeReady =
                    scenarioId === 'xtream-delete-large'
                        ? location.pathname.endsWith('/workspace/sources')
                        : location.pathname.includes('/workspace/xtreams/');
                if (state.operationStartEpochMs > 0 && routeReady) {
                    state.routeReadyEpochMs ??= epoch();
                }
                if (state.operationStartEpochMs > 0 && terminalDomGate()) {
                    state.domReadyEpochMs ??= epoch();
                    state.paintFrameCount += 1;
                    if (state.paintFrameCount >= 2) {
                        state.uiPaintedEpochMs = epoch();
                        state.terminalEpochMs = state.uiPaintedEpochMs;
                    }
                } else {
                    state.paintFrameCount = 0;
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
            scenarioId: options.scenarioId,
            sourceTitle: options.sourceTitle,
            stateKey: XTREAM_RENDERER_STATE_KEY,
            stoppedKey: XTREAM_RENDERER_STOPPED_KEY,
        }
    );
}

export {
    assertCompleteXtreamRendererProbe,
    assertXtreamBackgroundDeleteActive,
    assertXtreamBackgroundRefreshActive,
    beginXtreamRendererOperation,
    recordXtreamRendererHeartbeat,
    stopXtreamRendererProbe,
    waitForXtreamRendererTerminal,
} from './xtream-renderer-probe-control';
