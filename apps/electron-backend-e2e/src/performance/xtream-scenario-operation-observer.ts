import type { Page } from '@playwright/test';

const OPERATION_STATE_KEY = '__iptvnatorXtreamScenarioOperationWindow';
const DELETE_OPERATION = 'delete-xtream-content';
const OPERATION_TIMEOUT_MS = 120_000;

export interface XtreamOperationWindowSnapshot {
    readonly active: boolean;
    readonly operation: typeof DELETE_OPERATION;
    readonly operationId: string;
    readonly playlistId: string;
    readonly startedEpochMs: number;
    readonly terminalEpochMs: number | null;
    readonly terminalStatus: 'cancelled' | 'completed' | 'error' | null;
}

export interface XtreamOperationWindow {
    assertActive(): Promise<XtreamOperationWindowSnapshot>;
    dispose(): Promise<void>;
    waitForActive(): Promise<XtreamOperationWindowSnapshot>;
    waitForTerminal(): Promise<XtreamOperationWindowSnapshot>;
}

export async function installXtreamOperationWindow(
    page: Page
): Promise<XtreamOperationWindow> {
    await page.evaluate(
        ({ command, operation, stateKey }) => {
            interface State {
                active: boolean;
                operation: string;
                operationId: string | null;
                playlistId: string | null;
                startedEpochMs: number | null;
                terminalEpochMs: number | null;
                terminalStatus: string | null;
                unsubscribe: () => void;
            }
            const target = globalThis as unknown as Record<string, unknown>;
            if (command !== 'install-operation' || target[stateKey]) {
                throw new Error('xtream-operation-window-state-invalid');
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
                active: false,
                operation,
                operationId: null,
                playlistId: null,
                startedEpochMs: null,
                terminalEpochMs: null,
                terminalStatus: null,
                unsubscribe: () => undefined,
            };
            state.unsubscribe = electron.onDbOperationEvent((event) => {
                if (event['operation'] !== operation) return;
                const status = event['status'];
                if (status === 'started' && state.startedEpochMs === null) {
                    state.active = true;
                    state.startedEpochMs = epoch();
                    state.operationId =
                        typeof event['operationId'] === 'string'
                            ? event['operationId']
                            : null;
                    state.playlistId =
                        typeof event['playlistId'] === 'string'
                            ? event['playlistId']
                            : null;
                    return;
                }
                if (
                    !state.active ||
                    !['cancelled', 'completed', 'error'].includes(
                        String(status)
                    )
                ) {
                    return;
                }
                const eventOperationId =
                    typeof event['operationId'] === 'string'
                        ? event['operationId']
                        : null;
                if (
                    state.operationId !== null &&
                    eventOperationId !== state.operationId
                ) {
                    return;
                }
                state.active = false;
                state.terminalEpochMs = epoch();
                state.terminalStatus = String(status);
            });
            target[stateKey] = state;
        },
        {
            command: 'install-operation',
            operation: DELETE_OPERATION,
            stateKey: OPERATION_STATE_KEY,
        }
    );
    return {
        assertActive: () => assertOperationActive(page),
        dispose: () => disposeOperationState(page),
        async waitForActive() {
            await waitForOperationState(page, 'operation-active');
            return assertOperationActive(page);
        },
        async waitForTerminal() {
            await waitForOperationState(page, 'operation-terminal');
            return readOperationSnapshot(page);
        },
    };
}

async function waitForOperationState(
    page: Page,
    waitFor: 'operation-active' | 'operation-terminal'
): Promise<void> {
    await page.waitForFunction(
        ({ stateKey, waitFor: condition }) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const state = target[stateKey] as
                | {
                      active?: boolean;
                      terminalEpochMs?: number | null;
                  }
                | undefined;
            return condition === 'operation-active'
                ? state?.active === true
                : typeof state?.terminalEpochMs === 'number';
        },
        { stateKey: OPERATION_STATE_KEY, waitFor },
        { timeout: OPERATION_TIMEOUT_MS }
    );
}

async function assertOperationActive(
    page: Page
): Promise<XtreamOperationWindowSnapshot> {
    const snapshot = await readOperationSnapshot(page);
    if (!snapshot.active || snapshot.terminalEpochMs !== null) {
        throw new Error('xtream-background-action-outside-delete-window');
    }
    return snapshot;
}

async function readOperationSnapshot(
    page: Page
): Promise<XtreamOperationWindowSnapshot> {
    const value = await page.evaluate(
        ({ stateKey }) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const state = target[stateKey];
            if (!state) throw new Error('xtream-operation-window-missing');
            const {
                active,
                operation,
                operationId,
                playlistId,
                startedEpochMs,
                terminalEpochMs,
                terminalStatus,
            } = state as Record<string, unknown>;
            return {
                active,
                operation,
                operationId,
                playlistId,
                startedEpochMs,
                terminalEpochMs,
                terminalStatus,
            };
        },
        { command: 'snapshot-operation', stateKey: OPERATION_STATE_KEY }
    );
    if (!isOperationSnapshot(value)) {
        throw new Error('xtream-operation-window-invalid');
    }
    return value;
}

async function disposeOperationState(page: Page): Promise<void> {
    await page.evaluate(
        ({ stateKey }) => {
            const target = globalThis as unknown as Record<string, unknown>;
            const state = target[stateKey] as
                { unsubscribe?: () => void } | undefined;
            state?.unsubscribe?.();
            delete target[stateKey];
        },
        { command: 'dispose-observer', stateKey: OPERATION_STATE_KEY }
    );
}

function isOperationSnapshot(
    value: unknown
): value is XtreamOperationWindowSnapshot {
    if (!isRecord(value)) return false;
    const active = value['active'];
    const startedEpochMs = value['startedEpochMs'];
    const terminalEpochMs = value['terminalEpochMs'];
    const terminalStatus = value['terminalStatus'];
    return (
        value['operation'] === DELETE_OPERATION &&
        typeof active === 'boolean' &&
        finitePositive(startedEpochMs) &&
        nonEmptyString(value['operationId']) &&
        nonEmptyString(value['playlistId']) &&
        (active
            ? terminalEpochMs === null && terminalStatus === null
            : finitePositive(terminalEpochMs) &&
              terminalEpochMs >= startedEpochMs &&
              ['cancelled', 'completed', 'error'].includes(
                  String(terminalStatus)
              ))
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function finitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}
