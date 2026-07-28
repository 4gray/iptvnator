import {
    XTREAM_SCENARIO_ID,
    type XtreamControlState,
    type XtreamLedgerEntry,
    type XtreamOccurrence,
    type XtreamScenarioId,
} from './xtream-benchmark-contract';

const FULL_ACTIONS = [
    'get_account_info',
    'get_live_categories',
    'get_vod_categories',
    'get_series_categories',
    'get_live_streams',
    'get_vod_streams',
    'get_series',
] as const;
const CATEGORY_ACTIONS = FULL_ACTIONS.slice(1, 4);

interface ExpectedAction {
    readonly action: string;
    readonly count: number;
}

interface RequestLifecycle {
    readonly arrived: number;
    readonly responded: number;
}

export function assertXtreamScenarioObservations(
    scenarioId: XtreamScenarioId,
    state: XtreamControlState
): void {
    const expected = expectedActions(scenarioId);
    if (
        state.occurrences.length !== expected.length ||
        state.ledger.length !==
            expected.reduce((total, entry) => total + entry.count * 2, 0)
    ) {
        throw new Error('action cardinality');
    }

    const lifecycle = new Map<string, readonly RequestLifecycle[]>();
    for (const expectedAction of expected) {
        const occurrences = state.occurrences.filter(
            (entry) => entry.action === expectedAction.action
        );
        const entries = state.ledger.filter(
            (entry) => entry.action === expectedAction.action
        );
        if (
            occurrences.length !== 1 ||
            !isExpectedOccurrence(occurrences[0], expectedAction.count) ||
            entries.length !== expectedAction.count * 2
        ) {
            throw new Error('action occurrence');
        }

        const requests = Array.from(
            { length: expectedAction.count },
            (_, index) => requestLifecycle(entries, state.epoch, index + 1)
        );
        assertOccurrenceStartOrder(requests);
        lifecycle.set(expectedAction.action, requests);
    }
    if (
        state.occurrences.some(
            (entry) => !expected.some(({ action }) => action === entry.action)
        ) ||
        state.ledger.some(
            (entry) => !expected.some(({ action }) => action === entry.action)
        )
    ) {
        throw new Error('unexpected action');
    }
    assertActionOrder(scenarioId, expected, lifecycle);
}

function expectedActions(
    scenarioId: XtreamScenarioId
): readonly ExpectedAction[] {
    if (scenarioId === XTREAM_SCENARIO_ID.DELETE_LARGE) return [];
    const actions =
        scenarioId === XTREAM_SCENARIO_ID.CANCEL_IMPORT
            ? FULL_ACTIONS.slice(0, 5)
            : FULL_ACTIONS;
    return actions.map((action) => ({
        action,
        count: action === 'get_account_info' ? 2 : 1,
    }));
}

function requestLifecycle(
    entries: readonly XtreamLedgerEntry[],
    epoch: number,
    occurrence: number
): RequestLifecycle {
    const requestEntries = entries.filter(
        (entry) => entry.occurrence === occurrence
    );
    const arrived = requestEntries.find((entry) => entry.status === 'arrived');
    const responded = requestEntries.find(
        (entry) => entry.status === 'responded'
    );
    if (
        requestEntries.length !== 2 ||
        !isExpectedLedger(arrived, epoch, occurrence) ||
        !isExpectedLedger(responded, epoch, occurrence) ||
        arrived.status !== 'arrived' ||
        responded.status !== 'responded' ||
        arrived.atMs > responded.atMs
    ) {
        throw new Error('action lifecycle');
    }
    return { arrived: arrived.atMs, responded: responded.atMs };
}

function assertOccurrenceStartOrder(
    requests: readonly RequestLifecycle[]
): void {
    for (let index = 1; index < requests.length; index += 1) {
        if (
            (requests[index - 1]?.arrived ?? Number.POSITIVE_INFINITY) >
            (requests[index]?.arrived ?? Number.NEGATIVE_INFINITY)
        ) {
            throw new Error('occurrence start order');
        }
    }
}

function assertActionOrder(
    scenarioId: XtreamScenarioId,
    expected: readonly ExpectedAction[],
    lifecycle: ReadonlyMap<string, readonly RequestLifecycle[]>
): void {
    if (expected.length === 0) return;
    const accounts = lifecycle.get('get_account_info');
    const routeHydratesAfterImport =
        scenarioId === XTREAM_SCENARIO_ID.REFRESH_LARGE ||
        scenarioId === XTREAM_SCENARIO_ID.BACKGROUND_UI;
    const account = routeHydratesAfterImport ? accounts?.[0] : accounts?.at(-1);
    const liveCategory = lifecycle.get(CATEGORY_ACTIONS[0])?.[0];
    const vodCategory = lifecycle.get(CATEGORY_ACTIONS[1])?.[0];
    const seriesCategory = lifecycle.get(CATEGORY_ACTIONS[2])?.[0];
    const live = lifecycle.get('get_live_streams')?.[0];
    if (
        !account ||
        !liveCategory ||
        !vodCategory ||
        !seriesCategory ||
        account.responded >
            Math.min(
                liveCategory.arrived,
                vodCategory.arrived,
                seriesCategory.arrived
            ) ||
        !live ||
        Math.max(
            liveCategory.responded,
            vodCategory.responded,
            seriesCategory.responded
        ) > live.arrived
    ) {
        throw new Error('action order');
    }
    const vod = lifecycle.get('get_vod_streams')?.[0];
    const series = lifecycle.get('get_series')?.[0];
    if (
        (vod && live.responded > vod.arrived) ||
        (series && (!vod || vod.responded > series.arrived)) ||
        (routeHydratesAfterImport &&
            (!series ||
                !accounts?.[1] ||
                series.responded > accounts[1].arrived))
    ) {
        throw new Error('content order');
    }
}

function isExpectedOccurrence(
    value: XtreamOccurrence | undefined,
    count: number
): boolean {
    return (
        value?.scenario === 'performance-100k' &&
        value.transport === 'direct' &&
        value.categoryId === 'all' &&
        value.count === count
    );
}

function isExpectedLedger(
    value: XtreamLedgerEntry | undefined,
    epoch: number,
    occurrence: number
): value is XtreamLedgerEntry {
    return (
        value?.scenario === 'performance-100k' &&
        value.transport === 'direct' &&
        value.categoryId === 'all' &&
        value.epoch === epoch &&
        value.occurrence === occurrence
    );
}
