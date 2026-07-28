import {
    XTREAM_SCENARIO_ID,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';

export interface XtreamRendererConsoleErrorBreakdown {
    databaseSaveCancellation: number;
    fetchContentCancellation: number;
    initializationCancellation: number;
    unexpected: number;
}

type XtreamRendererConsoleErrorKind = keyof XtreamRendererConsoleErrorBreakdown;

const CANCELLATION_SIGNATURE = 'Operation "save-content" was cancelled';

export function createXtreamRendererConsoleErrorBreakdown(): XtreamRendererConsoleErrorBreakdown {
    return {
        databaseSaveCancellation: 0,
        fetchContentCancellation: 0,
        initializationCancellation: 0,
        unexpected: 0,
    };
}

export function recordXtreamRendererConsoleError(
    breakdown: XtreamRendererConsoleErrorBreakdown,
    scenarioId: XtreamScenarioId,
    message: string
): void {
    const kind = classifyXtreamRendererConsoleError(scenarioId, message);
    breakdown[kind] += 1;
}

export function validXtreamRendererConsoleErrorEvidence(
    total: number,
    breakdown: XtreamRendererConsoleErrorBreakdown,
    scenarioId: XtreamScenarioId
): boolean {
    if (
        !Number.isSafeInteger(total) ||
        total < 0 ||
        !validBreakdownCounts(breakdown) ||
        total !== totalBreakdownCount(breakdown)
    ) {
        return false;
    }
    if (scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT) {
        return (
            breakdown.databaseSaveCancellation === 1 &&
            breakdown.fetchContentCancellation === 1 &&
            breakdown.initializationCancellation === 1 &&
            breakdown.unexpected === 0
        );
    }
    return total === 0;
}

function classifyXtreamRendererConsoleError(
    scenarioId: XtreamScenarioId,
    message: string
): XtreamRendererConsoleErrorKind {
    if (
        scenarioId !== XTREAM_SCENARIO_ID.CANCEL_IMPORT ||
        !message.includes(CANCELLATION_SIGNATURE)
    ) {
        return 'unexpected';
    }
    if (message.startsWith('Error saving Xtream content:')) {
        return 'databaseSaveCancellation';
    }
    if (message.startsWith('[withContent] Error fetching content')) {
        return 'fetchContentCancellation';
    }
    if (message.startsWith('[withContent] Error initializing content')) {
        return 'initializationCancellation';
    }
    return 'unexpected';
}

function totalBreakdownCount(
    breakdown: XtreamRendererConsoleErrorBreakdown
): number {
    return (
        breakdown.databaseSaveCancellation +
        breakdown.fetchContentCancellation +
        breakdown.initializationCancellation +
        breakdown.unexpected
    );
}

function validBreakdownCounts(
    breakdown: XtreamRendererConsoleErrorBreakdown
): boolean {
    return Object.values(breakdown).every(
        (value) => Number.isSafeInteger(value) && value >= 0
    );
}
