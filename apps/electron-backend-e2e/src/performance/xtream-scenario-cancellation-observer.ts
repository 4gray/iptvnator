import type { Page } from '@playwright/test';

const CANCELLATION_STATE_KEY = '__iptvnatorXtreamScenarioCancellationObserver';
const OPERATION_TIMEOUT_MS = 120_000;

export interface XtreamDbOperationEventLike {
    readonly current?: number;
    readonly operation?: string;
    readonly operationId?: string;
    readonly status?: string;
    readonly total?: number;
}

export interface XtreamCancellationEvidence {
    readonly armedEpochMs: number;
    readonly clickEpochMs: number;
    readonly current: number;
    readonly operationId: string;
    readonly progressEpochMs: number;
    readonly threshold: number;
    readonly total: number;
}

export interface XtreamCancellationObserver {
    dispose(): Promise<void>;
    waitForClick(): Promise<XtreamCancellationEvidence>;
}

export function xtreamCancellationThreshold(total: number): number {
    if (!Number.isFinite(total) || total <= 0) {
        throw new Error('xtream-cancellation-total-invalid');
    }
    return Math.max(100, Math.floor(total * 0.1));
}

export function isXtreamCancellationProgress(event: unknown): boolean {
    if (!isRecord(event)) return false;
    const current = event['current'];
    const operationId = event['operationId'];
    const total = event['total'];
    return (
        event['operation'] === 'save-content' &&
        event['status'] === 'progress' &&
        typeof current === 'number' &&
        Number.isSafeInteger(current) &&
        typeof operationId === 'string' &&
        operationId.length > 0 &&
        typeof total === 'number' &&
        Number.isSafeInteger(total) &&
        total > 0 &&
        current <= total &&
        current >= xtreamCancellationThreshold(total)
    );
}

export async function installXtreamCancellationObserver(
    page: Page
): Promise<XtreamCancellationObserver> {
    await page.evaluate(
        ({ command, stateKey }) => {
            interface State {
                armedEpochMs: number;
                clickEpochMs: number | null;
                current: number | null;
                failure: string | null;
                operationId: string | null;
                progressEpochMs: number | null;
                threshold: number | null;
                total: number | null;
                unsubscribe: () => void;
            }
            const target = globalThis as unknown as Record<string, unknown>;
            if (command !== 'install-cancellation' || target[stateKey]) {
                throw new Error('xtream-cancellation-observer-state-invalid');
            }
            const electron = target['electron'] as
                | {
                      onDbOperationEvent?: (
                          callback: (event: Record<string, unknown>) => void
                      ) => () => void;
                  }
                | undefined;
            if (typeof electron?.onDbOperationEvent !== 'function') {
                throw new Error('xtream-db-operation-listener-unavailable');
            }
            const epoch = (): number =>
                performance.timeOrigin + performance.now();
            const state: State = {
                armedEpochMs: epoch(),
                clickEpochMs: null,
                current: null,
                failure: null,
                operationId: null,
                progressEpochMs: null,
                threshold: null,
                total: null,
                unsubscribe: () => undefined,
            };
            state.unsubscribe = electron.onDbOperationEvent((event) => {
                if (state.clickEpochMs !== null || state.failure !== null) {
                    return;
                }
                const current = event['current'];
                const total = event['total'];
                if (
                    event['operation'] !== 'save-content' ||
                    event['status'] !== 'progress' ||
                    typeof current !== 'number' ||
                    !Number.isSafeInteger(current) ||
                    typeof total !== 'number' ||
                    !Number.isSafeInteger(total) ||
                    total <= 0 ||
                    current > total
                ) {
                    return;
                }
                const threshold = Math.max(100, Math.floor(total * 0.1));
                if (current < threshold) return;
                state.current = current;
                state.total = total;
                state.threshold = threshold;
                state.progressEpochMs = epoch();
                const operationId = event['operationId'];
                if (
                    typeof operationId !== 'string' ||
                    operationId.length === 0
                ) {
                    state.failure = 'xtream-save-content-identity-missing';
                    return;
                }
                state.operationId = operationId;
                const button = document.querySelector(
                    '.workspace-loading-overlay__action'
                );
                if (
                    !(button instanceof HTMLButtonElement) ||
                    !button.isConnected
                ) {
                    state.failure = 'xtream-cancel-button-missing';
                    return;
                }
                if (button.disabled) {
                    state.failure = 'xtream-cancel-button-disabled';
                    return;
                }
                state.clickEpochMs = epoch();
                button.click();
            });
            target[stateKey] = state;
        },
        {
            command: 'install-cancellation',
            stateKey: CANCELLATION_STATE_KEY,
        }
    );
    return {
        dispose: () => disposeCancellationState(page),
        async waitForClick() {
            await page.waitForFunction(
                ({ stateKey }) => {
                    const target = globalThis as unknown as Record<
                        string,
                        unknown
                    >;
                    const state = target[stateKey] as
                        | {
                              clickEpochMs?: number | null;
                              failure?: string | null;
                          }
                        | undefined;
                    return Boolean(
                        state &&
                        (typeof state.clickEpochMs === 'number' ||
                            typeof state.failure === 'string')
                    );
                },
                {
                    stateKey: CANCELLATION_STATE_KEY,
                    waitFor: 'cancellation-click',
                },
                { timeout: OPERATION_TIMEOUT_MS }
            );
            return readCancellationEvidence(page);
        },
    };
}

async function readCancellationEvidence(
    page: Page
): Promise<XtreamCancellationEvidence> {
    const value = await page.evaluate(
        ({ stateKey }) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const state = target[stateKey] as
                Record<string, unknown> | undefined;
            if (!state) throw new Error('xtream-cancellation-observer-missing');
            if (state['failure']) throw new Error(String(state['failure']));
            return {
                armedEpochMs: state['armedEpochMs'],
                clickEpochMs: state['clickEpochMs'],
                current: state['current'],
                operationId: state['operationId'],
                progressEpochMs: state['progressEpochMs'],
                threshold: state['threshold'],
                total: state['total'],
            };
        },
        { command: 'snapshot-cancellation', stateKey: CANCELLATION_STATE_KEY }
    );
    if (!isCancellationEvidence(value)) {
        throw new Error('xtream-cancellation-evidence-invalid');
    }
    return value;
}

async function disposeCancellationState(page: Page): Promise<void> {
    await page.evaluate(
        ({ stateKey }) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const state = target[stateKey] as
                { unsubscribe?: () => void } | undefined;
            state?.unsubscribe?.();
            delete target[stateKey];
        },
        { command: 'dispose-observer', stateKey: CANCELLATION_STATE_KEY }
    );
}

function isCancellationEvidence(
    value: unknown
): value is XtreamCancellationEvidence {
    if (!isRecord(value)) return false;
    const armedEpochMs = value['armedEpochMs'];
    const clickEpochMs = value['clickEpochMs'];
    const current = value['current'];
    const operationId = value['operationId'];
    const progressEpochMs = value['progressEpochMs'];
    const threshold = value['threshold'];
    const total = value['total'];
    return (
        finitePositive(armedEpochMs) &&
        finitePositive(progressEpochMs) &&
        finitePositive(clickEpochMs) &&
        armedEpochMs <= progressEpochMs &&
        progressEpochMs <= clickEpochMs &&
        typeof operationId === 'string' &&
        operationId.length > 0 &&
        typeof total === 'number' &&
        Number.isSafeInteger(total) &&
        total > 0 &&
        typeof current === 'number' &&
        Number.isSafeInteger(current) &&
        current >= 0 &&
        current <= total &&
        typeof threshold === 'number' &&
        Number.isSafeInteger(threshold) &&
        threshold === xtreamCancellationThreshold(total) &&
        current >= threshold
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function finitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
