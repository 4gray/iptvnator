import type {
    XtreamControlState,
    XtreamLedgerEntry,
    XtreamOccurrence,
    XtreamPerformanceManifest,
    XtreamScenarioId,
} from './xtream-benchmark-contract';
import {
    assertXtreamArtifactRedacted,
    assertXtreamManifest,
    assertXtreamManifestIdentity,
} from './xtream-diagnostic-artifacts';
import {
    parseXtreamControlState,
    parseXtreamManifest,
} from './xtream-control-state-schema';

export {
    assertXtreamArtifactRedacted,
    assertXtreamManifest,
    assertXtreamManifestIdentity,
    parseXtreamControlState,
    parseXtreamManifest,
};

export interface XtreamControlClientOptions {
    readonly fetchImpl?: typeof fetch;
    readonly origin: string;
    readonly token: string;
}

export interface XtreamControlClient {
    prepare(): Promise<XtreamPerformanceManifest>;
    resetAll(): Promise<void>;
    resetObservations(): Promise<void>;
    state(): Promise<XtreamControlState>;
}

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
export function createXtreamControlClient(
    options: XtreamControlClientOptions
): XtreamControlClient {
    let origin: string;
    let token: string;
    let configuredFetch: typeof fetch | undefined;
    try {
        origin = options.origin;
        token = options.token;
        configuredFetch = options.fetchImpl;
    } catch {
        throw new Error('Xtream benchmark control options are invalid');
    }
    assertXtreamMockOrigin(origin);
    if (!isValidControlToken(token)) {
        throw new Error('Xtream benchmark requires a non-empty control token');
    }
    const fetchImpl = configuredFetch ?? globalThis.fetch;
    const request = async (
        path: '/__control/prepare' | '/__control/reset' | '/__control/state',
        label: string,
        body?: Readonly<Record<string, string>>
    ): Promise<unknown> => {
        let response: Response;
        const requestUrl = `${origin}${path}`;
        try {
            response = await fetchImpl(requestUrl, {
                method: body ? 'POST' : 'GET',
                redirect: 'error',
                headers: {
                    'x-iptvnator-performance-token': token,
                    ...(body ? { 'content-type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
        } catch {
            throw new Error(`Xtream control ${label} transport failed`);
        }
        const metadata = snapshotControlResponse(response, label);
        if (!metadata.ok) {
            throw new Error(
                `Xtream control ${label} failed with HTTP ${metadata.status}`
            );
        }
        if (metadata.redirected || metadata.url !== requestUrl) {
            throw new Error(
                `Xtream control ${label} redirect or origin rejected`
            );
        }
        try {
            return (await Reflect.apply(
                metadata.json,
                response,
                []
            )) as unknown;
        } catch {
            throw new Error(`Xtream ${label} invalid control response`);
        }
    };
    const reset = async (mode: 'all' | 'observations'): Promise<void> => {
        const value = await request('/__control/reset', `${mode} reset`, {
            mode,
        });
        try {
            if (!isRecordWithKeys(value, ['epoch', 'mode'])) {
                throw new Error('invalid reset response');
            }
            const epoch = Reflect.get(value, 'epoch');
            const responseMode = Reflect.get(value, 'mode');
            if (!isPositiveSafeInteger(epoch) || responseMode !== mode) {
                throw new Error('invalid reset response');
            }
        } catch {
            throw new Error(`Xtream ${mode} reset invalid control response`);
        }
    };
    return Object.freeze({
        async prepare() {
            const value = await request('/__control/prepare', 'prepare', {
                scenario: 'performance-100k',
            });
            try {
                return parseXtreamManifest(value);
            } catch {
                throw new Error('Xtream prepare invalid control response');
            }
        },
        resetAll: () => reset('all'),
        resetObservations: () => reset('observations'),
        async state() {
            const value = await request('/__control/state', 'state');
            try {
                return parseXtreamControlState(value);
            } catch {
                throw new Error('Xtream state invalid control response');
            }
        },
    });
}

export function assertXtreamMockOrigin(value: unknown): void {
    if (typeof value !== 'string') throw invalidOrigin();
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw invalidOrigin();
    }
    if (
        url.protocol !== 'http:' ||
        url.hostname !== '127.0.0.1' ||
        url.port.length === 0 ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        url.pathname !== '/' ||
        url.search.length > 0 ||
        url.hash.length > 0 ||
        value !== url.origin
    ) {
        throw invalidOrigin();
    }
}

function snapshotControlResponse(
    response: Response,
    label: string
): {
    readonly json: () => Promise<unknown>;
    readonly ok: boolean;
    readonly redirected: boolean;
    readonly status: number;
    readonly url: string;
} {
    try {
        const json = Reflect.get(response, 'json') as unknown;
        const ok = Reflect.get(response, 'ok') as unknown;
        const redirected = Reflect.get(response, 'redirected') as unknown;
        const status = Reflect.get(response, 'status') as unknown;
        const url = Reflect.get(response, 'url') as unknown;
        if (
            typeof json !== 'function' ||
            typeof ok !== 'boolean' ||
            typeof redirected !== 'boolean' ||
            !Number.isSafeInteger(status) ||
            Number(status) < 100 ||
            Number(status) > 599 ||
            typeof url !== 'string'
        ) {
            throw new Error('invalid response metadata');
        }
        return {
            json: json as () => Promise<unknown>,
            ok,
            redirected,
            status: Number(status),
            url,
        };
    } catch {
        throw new Error(`Xtream control ${label} invalid response metadata`);
    }
}

export function assertXtreamControlReadyAfterObservationReset(
    input: unknown,
    expectedManifest: XtreamPerformanceManifest
): asserts input is XtreamControlState {
    try {
        const state = parseXtreamControlState(input);
        assertPreparedState(state, expectedManifest);
        if (state.occurrences.length !== 0 || state.ledger.length !== 0) {
            throw new Error('observations remain');
        }
    } catch {
        throw new Error(
            'invalid Xtream mock readiness after observation reset'
        );
    }
}

export function assertXtreamControlStateForScenario(
    scenarioId: XtreamScenarioId,
    input: unknown,
    expectedManifest: XtreamPerformanceManifest
): asserts input is XtreamControlState {
    try {
        const state = parseXtreamControlState(input);
        assertPreparedState(state, expectedManifest);
        const expected =
            scenarioId === 'xtream-delete-large'
                ? []
                : scenarioId === 'xtream-cancel-import'
                  ? FULL_ACTIONS.slice(0, 5)
                  : FULL_ACTIONS;
        assertExactActions(state, expected);
    } catch {
        throw new Error('invalid Xtream mock observations');
    }
}

function assertPreparedState(
    state: XtreamControlState,
    manifest: XtreamPerformanceManifest
): void {
    if (
        state.prepared === null ||
        state.epoch !== manifest.epoch ||
        state.prepared.epoch !== manifest.epoch ||
        state.rules.length !== 0 ||
        state.heldCount !== 0 ||
        state.heldIds.length !== 0
    ) {
        throw new Error('state residue');
    }
    assertXtreamManifestIdentity(manifest, state.prepared);
}

function assertExactActions(
    state: XtreamControlState,
    expected: readonly string[]
): void {
    if (
        state.occurrences.length !== expected.length ||
        state.ledger.length !== expected.length * 2
    ) {
        throw new Error('action cardinality');
    }
    const lifecycle = new Map<string, { arrived: number; responded: number }>();
    for (const action of expected) {
        const occurrence = state.occurrences.find(
            (entry) => entry.action === action
        );
        const entries = state.ledger.filter((entry) => entry.action === action);
        const arrived = entries.find((entry) => entry.status === 'arrived');
        const responded = entries.find((entry) => entry.status === 'responded');
        if (
            !isExpectedOccurrence(occurrence) ||
            entries.length !== 2 ||
            !isExpectedLedger(arrived, state.epoch, 1) ||
            !isExpectedLedger(responded, state.epoch, 1) ||
            arrived.status !== 'arrived' ||
            responded.status !== 'responded' ||
            arrived.atMs > responded.atMs
        ) {
            throw new Error('action lifecycle');
        }
        lifecycle.set(action, {
            arrived: arrived.atMs,
            responded: responded.atMs,
        });
    }
    if (
        state.occurrences.some((entry) => !expected.includes(entry.action)) ||
        state.ledger.some((entry) => !expected.includes(entry.action))
    ) {
        throw new Error('unexpected action');
    }
    assertActionOrder(expected, lifecycle);
}

function assertActionOrder(
    expected: readonly string[],
    lifecycle: ReadonlyMap<string, { arrived: number; responded: number }>
): void {
    if (expected.length === 0) return;
    const account = lifecycle.get('get_account_info');
    const liveCategory = lifecycle.get(CATEGORY_ACTIONS[0]);
    const vodCategory = lifecycle.get(CATEGORY_ACTIONS[1]);
    const seriesCategory = lifecycle.get(CATEGORY_ACTIONS[2]);
    const live = lifecycle.get('get_live_streams');
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
    const vod = lifecycle.get('get_vod_streams');
    const series = lifecycle.get('get_series');
    if (
        (vod && live.responded > vod.arrived) ||
        (series && (!vod || vod.responded > series.arrived))
    ) {
        throw new Error('content order');
    }
}

function isExpectedOccurrence(value: XtreamOccurrence | undefined): boolean {
    return (
        value?.scenario === 'performance-100k' &&
        value.transport === 'direct' &&
        value.categoryId === 'all' &&
        value.count === 1
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordWithKeys(
    value: unknown,
    keys: readonly string[]
): value is Record<string, unknown> {
    return (
        isRecord(value) &&
        Object.keys(value).length === keys.length &&
        keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    );
}

function isPositiveSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function isValidControlToken(value: unknown): value is string {
    return typeof value === 'string' && /^[\x21-\x7e]{1,256}$/u.test(value);
}

function invalidOrigin(): Error {
    return new Error('mock must use the exact Xtream HTTP loopback origin');
}
