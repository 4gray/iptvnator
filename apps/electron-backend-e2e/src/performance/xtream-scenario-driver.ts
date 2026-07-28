import type { Locator, Page } from '@playwright/test';

import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import {
    installXtreamCancellationObserver,
    type XtreamCancellationEvidence,
    type XtreamCancellationObserver,
} from './xtream-scenario-cancellation-observer';
import {
    installXtreamOperationWindow,
    type XtreamOperationWindow,
    type XtreamOperationWindowSnapshot,
} from './xtream-scenario-operation-observer';
import {
    prepareXtreamAddTrigger,
    prepareXtreamSourceActionTrigger,
    waitForXtreamCancellationTerminal,
    waitForXtreamCatalogTerminal,
    waitForXtreamDeleteTerminal,
} from './xtream-scenario-ui';
import { assertXtreamMockOrigin } from './xtream-control-client';
import { assertXtreamBackgroundRefreshActive } from './xtream-renderer-probe';

export const XTREAM_SYNTHETIC_CREDENTIALS = Object.freeze({
    password: 'performance',
    username: 'performance',
} as const);

export const XTREAM_SCENARIO_DATABASE_REQUEST_COUNT: Readonly<
    Record<XtreamScenarioId, number>
> = Object.freeze({
    [XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE]: 30,
    [XTREAM_SCENARIO_ID.REFRESH_LARGE]: 51,
    [XTREAM_SCENARIO_ID.DELETE_LARGE]: 2,
    [XTREAM_SCENARIO_ID.CANCEL_IMPORT]: 24,
    [XTREAM_SCENARIO_ID.BACKGROUND_UI]: 54,
});

export interface PrepareXtreamScenarioOptions {
    readonly scenarioId: XtreamScenarioId;
    readonly serverUrl: string;
    readonly sourceTitle: string;
}

export interface XtreamBackgroundActionContext {
    readonly operation: 'delete-xtream-content';
    readonly operationId: string;
    readonly page: Page;
    readonly playlistId: string;
    readonly sourceTitle: string;
}

export interface XtreamBackgroundProbeEvidence<Result = unknown> {
    readonly completedEpochMs: number;
    readonly operation: 'delete-xtream-content';
    readonly operationId: string;
    readonly playlistId: string;
    readonly result: Result;
    readonly startedEpochMs: number;
}

export type XtreamBackgroundProbe<Result> = (
    context: XtreamBackgroundActionContext
) => Promise<Result>;

export interface XtreamScenarioTriggerEvidence {
    readonly scenarioId: XtreamScenarioId;
    readonly triggerEpochMs: number;
}

export interface XtreamScenarioTerminalEvidence {
    readonly backgroundProbe: XtreamBackgroundProbeEvidence | null;
    readonly cancellation: XtreamCancellationEvidence | null;
    readonly operation: XtreamOperationWindowSnapshot | null;
    readonly scenarioId: XtreamScenarioId;
    readonly terminalEpochMs: number;
}

export interface PreparedXtreamScenario {
    readonly backgroundOperation: XtreamOperationWindow | null;
    readonly expectedDatabaseRequestCount: number;
    readonly scenarioId: XtreamScenarioId;
    readonly sourceTitle: string;
    dispose(): Promise<void>;
    runBackgroundProbe<Result>(
        probe: XtreamBackgroundProbe<Result>
    ): Promise<XtreamBackgroundProbeEvidence<Result>>;
    trigger(): Promise<XtreamScenarioTriggerEvidence>;
    waitForTerminal(): Promise<XtreamScenarioTerminalEvidence>;
}

export async function prepareXtreamScenario(
    page: Page,
    options: PrepareXtreamScenarioOptions
): Promise<PreparedXtreamScenario> {
    validateOptions(options);
    const cancellationObserver: XtreamCancellationObserver | null = null;
    let backgroundOperation: XtreamOperationWindow | null = null;
    try {
        if (options.scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI) {
            backgroundOperation = await installXtreamOperationWindow(page);
        }
        const trigger = await prepareFinalTrigger(page, options);
        return createPreparedScenario({
            backgroundOperation,
            cancellationObserver,
            options,
            page,
            trigger,
        });
    } catch (error) {
        await Promise.allSettled([
            cancellationObserver?.dispose(),
            backgroundOperation?.dispose(),
        ]);
        throw error;
    }
}

interface PreparedState {
    readonly backgroundOperation: XtreamOperationWindow | null;
    cancellationObserver: XtreamCancellationObserver | null;
    readonly options: PrepareXtreamScenarioOptions;
    readonly page: Page;
    readonly trigger: Locator;
}

function createPreparedScenario(state: PreparedState): PreparedXtreamScenario {
    let triggered = false;
    let disposed = false;
    let backgroundProbeStarted = false;
    let backgroundProbe: XtreamBackgroundProbeEvidence | null = null;
    let terminalPromise: Promise<XtreamScenarioTerminalEvidence> | null = null;
    const dispose = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        await Promise.allSettled([
            state.cancellationObserver?.dispose(),
            state.backgroundOperation?.dispose(),
        ]);
    };
    const prepared: PreparedXtreamScenario = {
        backgroundOperation: state.backgroundOperation,
        expectedDatabaseRequestCount:
            XTREAM_SCENARIO_DATABASE_REQUEST_COUNT[state.options.scenarioId],
        scenarioId: state.options.scenarioId,
        sourceTitle: state.options.sourceTitle,
        dispose,
        async runBackgroundProbe<Result>(probe: XtreamBackgroundProbe<Result>) {
            if (!triggered) {
                throw new Error('xtream-scenario-not-triggered');
            }
            if (!state.backgroundOperation) {
                throw new Error('xtream-background-operation-unavailable');
            }
            if (backgroundProbeStarted) {
                throw new Error('xtream-background-probe-already-started');
            }
            if (typeof probe !== 'function') {
                throw new Error('xtream-background-probe-invalid');
            }
            backgroundProbeStarted = true;
            await state.backgroundOperation.waitForActive();
            const before = await state.backgroundOperation.assertActive();
            const startedEpochMs = Date.now();
            const result = await probe(actionContext(state, before));
            await assertXtreamBackgroundRefreshActive(state.page, {
                operationId: before.operationId,
                playlistId: before.playlistId,
            });
            const completedEpochMs = Date.now();
            const evidence: XtreamBackgroundProbeEvidence<Result> =
                Object.freeze({
                    completedEpochMs,
                    operation: before.operation,
                    operationId: before.operationId,
                    playlistId: before.playlistId,
                    result,
                    startedEpochMs,
                });
            backgroundProbe = evidence;
            return evidence;
        },
        async trigger() {
            if (triggered) {
                throw new Error('xtream-scenario-already-triggered');
            }
            triggered = true;
            if (state.options.scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT) {
                state.cancellationObserver =
                    await installXtreamCancellationObserver(state.page);
            }
            const triggerEpochMs = Date.now();
            await state.trigger.click();
            return {
                scenarioId: state.options.scenarioId,
                triggerEpochMs,
            };
        },
        async waitForTerminal() {
            if (!triggered) {
                throw new Error('xtream-scenario-not-triggered');
            }
            terminalPromise ??= waitForScenarioTerminal(
                state,
                () => backgroundProbe
            ).finally(dispose);
            return terminalPromise;
        },
    };
    return Object.freeze(prepared);
}

async function waitForScenarioTerminal(
    state: PreparedState,
    readBackgroundProbe: () => XtreamBackgroundProbeEvidence | null
): Promise<XtreamScenarioTerminalEvidence> {
    let cancellation: XtreamCancellationEvidence | null = null;
    let operation: XtreamOperationWindowSnapshot | null = null;
    switch (state.options.scenarioId) {
        case XTREAM_SCENARIO_ID.CANCEL_IMPORT:
            if (!state.cancellationObserver) {
                throw new Error('xtream-cancellation-observer-unavailable');
            }
            cancellation = await state.cancellationObserver.waitForClick();
            await waitForXtreamCancellationTerminal(state.page);
            break;
        case XTREAM_SCENARIO_ID.DELETE_LARGE:
            await waitForXtreamDeleteTerminal(
                state.page,
                state.options.sourceTitle
            );
            break;
        case XTREAM_SCENARIO_ID.BACKGROUND_UI:
            if (readBackgroundProbe() === null) {
                throw new Error('xtream-background-probe-incomplete');
            }
            if (!state.backgroundOperation) {
                throw new Error('xtream-background-operation-unavailable');
            }
            operation = await state.backgroundOperation.waitForTerminal();
            if (operation.terminalStatus !== 'completed') {
                throw new Error('xtream-background-delete-did-not-complete');
            }
            await waitForXtreamCatalogTerminal(state.page);
            break;
        case XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE:
        case XTREAM_SCENARIO_ID.REFRESH_LARGE:
            await waitForXtreamCatalogTerminal(state.page);
            break;
    }
    return {
        backgroundProbe: readBackgroundProbe(),
        cancellation,
        operation,
        scenarioId: state.options.scenarioId,
        terminalEpochMs: Date.now(),
    };
}

async function prepareFinalTrigger(
    page: Page,
    options: PrepareXtreamScenarioOptions
): Promise<Locator> {
    switch (options.scenarioId) {
        case XTREAM_SCENARIO_ID.INITIAL_IMPORT_LARGE:
        case XTREAM_SCENARIO_ID.CANCEL_IMPORT:
            return prepareXtreamAddTrigger(page, {
                ...XTREAM_SYNTHETIC_CREDENTIALS,
                serverUrl: options.serverUrl,
                sourceTitle: options.sourceTitle,
            });
        case XTREAM_SCENARIO_ID.REFRESH_LARGE:
        case XTREAM_SCENARIO_ID.BACKGROUND_UI:
            return prepareXtreamSourceActionTrigger(
                page,
                options.sourceTitle,
                'refresh'
            );
        case XTREAM_SCENARIO_ID.DELETE_LARGE:
            return prepareXtreamSourceActionTrigger(
                page,
                options.sourceTitle,
                'delete'
            );
    }
}

function actionContext(
    state: PreparedState,
    snapshot: XtreamOperationWindowSnapshot
): XtreamBackgroundActionContext {
    return {
        operation: snapshot.operation,
        operationId: snapshot.operationId,
        page: state.page,
        playlistId: snapshot.playlistId,
        sourceTitle: state.options.sourceTitle,
    };
}

function validateOptions(options: PrepareXtreamScenarioOptions): void {
    if (!(options.scenarioId in XTREAM_SCENARIO_DATABASE_REQUEST_COUNT)) {
        throw new Error('xtream-scenario-id-invalid');
    }
    try {
        assertXtreamMockOrigin(options.serverUrl);
    } catch {
        throw new Error('Xtream scenario requires a loopback mock origin');
    }
    if (
        options.sourceTitle.length === 0 ||
        options.sourceTitle.length > 128 ||
        options.sourceTitle.trim() !== options.sourceTitle ||
        hasControlCharacter(options.sourceTitle)
    ) {
        throw new Error('xtream-scenario-source-title-invalid');
    }
}

function hasControlCharacter(value: string): boolean {
    return Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
    });
}
