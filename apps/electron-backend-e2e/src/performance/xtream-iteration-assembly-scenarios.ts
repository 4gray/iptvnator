import { isDeepStrictEqual } from 'node:util';

import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';
import type { XtreamMainCaptureResult } from './m3u-refresh-main-capture';
import type {
    XtreamIpcAttributionSpan,
    XtreamPhaseAttributionInput,
} from './xtream-phase-attribution';
import type { XtreamRendererCaptureMetrics } from './xtream-renderer-capture';
import type {
    XtreamScenarioTerminalEvidence,
    XtreamScenarioTriggerEvidence,
} from './xtream-scenario-driver';
import {
    XTREAM_CANCEL_NETWORK_ABORT_REASON,
    type XtreamCancellationEvidence,
    type XtreamCancellationMetrics,
} from './xtream-summary-contract';
import {
    summarizeXtreamUiActionSamples,
    XTREAM_UI_ACTION_ORDER,
    type XtreamUiActionProbeResult,
    type XtreamUiActionSample,
} from './xtream-ui-action-probe';

const CANCELLATION_CLOCK_SKEW_TOLERANCE_MS = 1;

export interface XtreamScenarioAssembly {
    readonly backgroundMetrics: {
        readonly actionLatencyMs: number;
        readonly dashboardPaintVisibility: 'visible-without-overlay';
        readonly navigationLatencyMs: number;
        readonly searchLatencyMs: number;
    } | null;
    readonly cancellation: XtreamCancellationMetrics;
    readonly cancellationEvidence: XtreamCancellationEvidence | null;
}

export function assembleXtreamScenarioEvidence(input: {
    readonly main: XtreamMainCaptureResult;
    readonly phaseCapture: XtreamPhaseAttributionInput;
    readonly renderer: XtreamRendererCaptureMetrics;
    readonly scenarioId: XtreamScenarioId;
    readonly terminal: XtreamScenarioTerminalEvidence;
    readonly trigger: XtreamScenarioTriggerEvidence;
}): XtreamScenarioAssembly {
    assertEnvelope(input);
    return {
        backgroundMetrics: backgroundMetrics(input),
        ...cancellationEvidence(input),
    };
}

function assertEnvelope(input: {
    readonly main: XtreamMainCaptureResult;
    readonly phaseCapture: XtreamPhaseAttributionInput;
    readonly renderer: XtreamRendererCaptureMetrics;
    readonly scenarioId: XtreamScenarioId;
    readonly terminal: XtreamScenarioTerminalEvidence;
    readonly trigger: XtreamScenarioTriggerEvidence;
}): void {
    const start = input.phaseCapture.operationStartEpochMs;
    const terminal = input.phaseCapture.terminalEpochMs;
    if (
        input.trigger.scenarioId !== input.scenarioId ||
        input.terminal.scenarioId !== input.scenarioId ||
        input.renderer.probe.scenarioId !== input.scenarioId ||
        input.trigger.triggerEpochMs < Math.floor(start) ||
        input.trigger.triggerEpochMs > input.terminal.terminalEpochMs ||
        input.main.captureStartedEpochMs >
            input.main.measurementStartedEpochMs ||
        input.main.measurementStartedEpochMs > start ||
        input.renderer.measurementStartEpochMs < start ||
        input.renderer.probe.terminalEpochMs === null ||
        input.renderer.probe.terminalEpochMs >
            input.renderer.captureCutoffEpochMs ||
        input.renderer.captureCutoffEpochMs > input.main.captureCutoffEpochMs ||
        terminal > input.main.captureCutoffEpochMs ||
        input.main.captureCutoffEpochMs > input.main.captureStoppedEpochMs
    ) {
        invalid();
    }
}

function backgroundMetrics(
    input: Parameters<typeof assembleXtreamScenarioEvidence>[0]
): XtreamScenarioAssembly['backgroundMetrics'] {
    const background = input.terminal.backgroundProbe;
    const operation = input.terminal.operation;
    if (input.scenarioId !== XTREAM_SCENARIO_ID.BACKGROUND_UI) {
        if (background !== null || operation !== null) invalid();
        return null;
    }
    if (
        !background ||
        !operation ||
        operation.active ||
        operation.terminalStatus !== 'completed' ||
        operation.terminalEpochMs === null ||
        background.operation !== 'delete-xtream-content' ||
        operation.operation !== background.operation ||
        operation.operationId !== background.operationId ||
        operation.playlistId !== background.playlistId ||
        operation.startedEpochMs > background.startedEpochMs ||
        operation.terminalEpochMs > input.terminal.terminalEpochMs ||
        background.completedEpochMs > input.terminal.terminalEpochMs ||
        background.completedEpochMs >= input.renderer.probe.uiPaintedEpochMs
    ) {
        invalid();
    }
    const requests = input.main.requests.filter(
        ({ operation: candidate }) => candidate === 'DB_DELETE_XTREAM_CONTENT'
    );
    const request = requests[0];
    if (
        requests.length !== 1 ||
        !request ||
        request.operationId !== background.operationId ||
        request.playlistId !== background.playlistId ||
        request.workStartedEpochMs === null ||
        request.workEndedEpochMs === null ||
        background.startedEpochMs < request.workStartedEpochMs ||
        background.startedEpochMs > request.workEndedEpochMs ||
        request.workEndedEpochMs > input.terminal.terminalEpochMs
    ) {
        invalid();
    }
    const result = readUiResult(background.result);
    const firstSample = result.samples[0];
    const lastSample = result.samples.at(-1);
    const dashboardSample = result.samples.find(
        ({ kind }) => kind === 'dashboard'
    );
    const storeTerminalEpochMs = input.renderer.probe.storeTerminalEpochMs;
    if (
        !firstSample ||
        !lastSample ||
        !dashboardSample ||
        storeTerminalEpochMs === null ||
        firstSample.startEpochMs < background.startedEpochMs ||
        lastSample.endEpochMs > background.completedEpochMs ||
        lastSample.endEpochMs > storeTerminalEpochMs ||
        operation.terminalEpochMs > storeTerminalEpochMs ||
        request.workEndedEpochMs > storeTerminalEpochMs
    ) {
        invalid();
    }
    return {
        actionLatencyMs: requireNumber(result.action.max),
        dashboardPaintVisibility: result.dashboardPaintVisibility,
        navigationLatencyMs: requireNumber(result.navigation.max),
        searchLatencyMs: requireNumber(result.search.max),
    };
}

function readUiResult(value: unknown): XtreamUiActionProbeResult {
    if (!isRecord(value)) invalid();
    const samplesValue = value['samples'];
    if (
        value['dashboardPaintVisibility'] !== 'visible-without-overlay' ||
        !Array.isArray(samplesValue) ||
        samplesValue.length !== XTREAM_UI_ACTION_ORDER.length
    ) {
        invalid();
    }
    const samples = samplesValue.map((entry, index) =>
        readSample(entry, index)
    );
    if (
        samples.some((sample, index) => {
            const previous = samples[index - 1];
            return (
                previous !== undefined &&
                previous.endEpochMs > sample.startEpochMs
            );
        })
    ) {
        invalid();
    }
    const summary = summarizeXtreamUiActionSamples(samples);
    if (
        !isDeepStrictEqual(summary.action, value['action']) ||
        !isDeepStrictEqual(summary.navigation, value['navigation']) ||
        !isDeepStrictEqual(summary.search, value['search'])
    ) {
        invalid();
    }
    return {
        ...summary,
        dashboardPaintVisibility: 'visible-without-overlay',
        samples,
    };
}

function readSample(value: unknown, index: number): XtreamUiActionSample {
    if (
        !isRecord(value) ||
        value['activeAfter'] !== true ||
        value['activeBefore'] !== true ||
        value['kind'] !== XTREAM_UI_ACTION_ORDER[index] ||
        !['action', 'navigation', 'search'].includes(String(value['category']))
    ) {
        invalid();
    }
    const startEpochMs = requireNumber(value['startEpochMs']);
    const endEpochMs = requireNumber(value['endEpochMs']);
    const latencyMs = requireNumber(value['latencyMs']);
    if (
        endEpochMs < startEpochMs ||
        Math.abs(latencyMs - (endEpochMs - startEpochMs)) > 0.001
    ) {
        invalid();
    }
    return {
        activeAfter: true,
        activeBefore: true,
        category: value['category'] as XtreamUiActionSample['category'],
        endEpochMs,
        kind: value['kind'] as XtreamUiActionSample['kind'],
        latencyMs,
        startEpochMs,
    };
}

function cancellationEvidence(
    input: Parameters<typeof assembleXtreamScenarioEvidence>[0]
): Pick<XtreamScenarioAssembly, 'cancellation' | 'cancellationEvidence'> {
    const driver = input.terminal.cancellation;
    if (input.scenarioId !== XTREAM_SCENARIO_ID.CANCEL_IMPORT) {
        if (driver !== null) invalid();
        return {
            cancellation: emptyCancellation(),
            cancellationEvidence: null,
        };
    }
    const failed = input.main.requests.filter(
        ({ operation, success }) => operation === 'DB_SAVE_CONTENT' && !success
    );
    const request = failed[0];
    const timeline = input.main.cancelTimeline;
    const renderer = input.renderer.probe;
    if (
        failed.length !== 1 ||
        !request ||
        !driver ||
        typeof request.requestId !== 'string' ||
        typeof request.operationId !== 'string' ||
        driver.operationId !== request.operationId ||
        driver.armedEpochMs > driver.progressEpochMs ||
        driver.progressEpochMs > driver.clickEpochMs ||
        driver.threshold !== Math.max(100, Math.floor(driver.total * 0.1)) ||
        driver.current < driver.threshold ||
        renderer.cancellationClickEpochMs === null ||
        renderer.cancellationClickEpochMs < driver.clickEpochMs ||
        renderer.dbCancellationTerminalEpochMs === null ||
        timeline.length !== 3
    ) {
        invalid();
    }
    const dispatch = timeline[0];
    const receipt = timeline[1];
    const workerTerminal = timeline[2];
    const preload = ipcPair(input.phaseCapture.ipcSpans, 'dbCancelOperation');
    const authoritative = request.responseEpochMs;
    const painted = requireNumber(renderer.uiPaintedEpochMs);
    // Renderer and main sample independent clocks, so allow their correlated
    // terminal timestamps to invert only within the known sub-millisecond skew.
    if (
        !dispatch ||
        !receipt ||
        !workerTerminal ||
        dispatch.type !== 'db-cancel-dispatched' ||
        receipt.type !== 'db-cancel-received' ||
        workerTerminal.type !== 'db-cancel-terminal-received' ||
        renderer.dbCancellationTerminalEpochMs <
            workerTerminal.epochMs - CANCELLATION_CLOCK_SKEW_TOLERANCE_MS ||
        renderer.dbCancellationTerminalEpochMs > painted ||
        authoritative > painted
    ) {
        invalid();
    }
    const click = driver.clickEpochMs;
    const cancellation: XtreamCancellationMetrics = {
        acknowledgementLatencyMs: authoritative - click,
        authoritativeDatabaseAcknowledgementObserved: true,
        authoritativeTerminalEpochMs: authoritative,
        clickEpochMs: click,
        clickToDatabaseDispatchMs: dispatch.epochMs - click,
        clickToPaintMs: painted - click,
        clickToPreloadReturnMs: preload[1].endEpochMs - click,
        databaseDispatchEpochMs: dispatch.epochMs,
        failedDatabaseRequestId: request.requestId,
        failedOperationId: request.operationId,
        mainNetworkAbortObserved: false,
        mainNetworkAbortReason:
            XTREAM_CANCEL_NETWORK_ABORT_REASON.AFTER_NETWORK_COMPLETE,
        paintedEpochMs: painted,
        preloadReturnEpochMs: preload[1].endEpochMs,
        preloadStartEpochMs: preload[0].startEpochMs,
        workerReceiptEpochMs: receipt.epochMs,
        workerReceiptIsAuthoritative: false,
        workerReceiptLatencyMs: receipt.epochMs - click,
    };
    if (
        Object.values(cancellation).some(
            (entry) => typeof entry === 'number' && entry < 0
        )
    ) {
        invalid();
    }
    return {
        cancellation,
        cancellationEvidence: {
            timeline: timeline.map((entry) => ({ ...entry })),
        },
    };
}

function ipcPair(
    spans: readonly XtreamIpcAttributionSpan[],
    method: string
): readonly [XtreamIpcAttributionSpan, XtreamIpcAttributionSpan] {
    const selected = spans.filter((span) => span.method === method);
    const request = selected.find(({ boundary }) => boundary === 'request');
    const response = selected.find(({ boundary }) => boundary === 'response');
    if (selected.length !== 2 || !request || !response) invalid();
    return [request, response];
}

function emptyCancellation(): XtreamCancellationMetrics {
    return {
        acknowledgementLatencyMs: null,
        authoritativeDatabaseAcknowledgementObserved: false,
        authoritativeTerminalEpochMs: null,
        clickEpochMs: null,
        clickToDatabaseDispatchMs: null,
        clickToPaintMs: null,
        clickToPreloadReturnMs: null,
        databaseDispatchEpochMs: null,
        failedDatabaseRequestId: null,
        failedOperationId: null,
        mainNetworkAbortObserved: false,
        mainNetworkAbortReason: null,
        paintedEpochMs: null,
        preloadReturnEpochMs: null,
        preloadStartEpochMs: null,
        workerReceiptEpochMs: null,
        workerReceiptIsAuthoritative: false,
        workerReceiptLatencyMs: null,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        invalid();
    return value;
}

function invalid(): never {
    throw new Error('invalid Xtream scenario assembly evidence');
}
