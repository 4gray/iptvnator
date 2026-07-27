import type {
    PerformanceAction,
    PerformanceRuleInput,
    PerformanceRuleMatch,
    PerformanceTransport,
} from './performance-control.types.js';

const RULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PERFORMANCE_SCENARIO = 'performance-100k';
const TRANSPORTS: readonly PerformanceTransport[] = ['direct', 'proxy'];
const ACTIONS: readonly PerformanceAction[] = [
    'get_account_info',
    'get_live_categories',
    'get_vod_categories',
    'get_series_categories',
    'get_live_streams',
    'get_vod_streams',
    'get_series',
    'get_vod_info',
    'get_series_info',
    'get_short_epg',
    'get_simple_data_table',
    'get_simple_date_table',
];

export class PerformanceControlError extends Error {
    constructor(
        readonly status: number,
        readonly code: string
    ) {
        super(code);
    }
}

export function parsePrepareBody(value: unknown): {
    scenario: typeof PERFORMANCE_SCENARIO;
} {
    requireExactObject(value, ['scenario']);
    if (value['scenario'] !== PERFORMANCE_SCENARIO) {
        invalid();
    }
    return { scenario: PERFORMANCE_SCENARIO };
}

export function parseResetBody(value: unknown): {
    mode: 'all' | 'observations';
} {
    requireExactObject(value, ['mode']);
    const mode = value['mode'];
    if (mode !== 'all' && mode !== 'observations') invalid();
    return { mode };
}

export function parseRuleBody(
    kind: 'barrier' | 'delay',
    value: unknown
): PerformanceRuleInput {
    const keys =
        kind === 'barrier' ? ['id', 'match'] : ['id', 'match', 'milliseconds'];
    requireExactObject(value, keys);
    const id = value['id'];
    if (typeof id !== 'string' || !RULE_ID_PATTERN.test(id)) invalid();
    const match = parseMatch(value['match']);

    if (kind === 'barrier') {
        return { id, kind, match };
    }
    const milliseconds = value['milliseconds'];
    if (
        !Number.isInteger(milliseconds) ||
        (milliseconds as number) < 0 ||
        (milliseconds as number) > 5_000
    ) {
        invalid();
    }
    return { id, kind, match, milliseconds: milliseconds as number };
}

export function parseReleaseBody(value: unknown): void {
    if (value === undefined) return;
    requireExactObject(value, []);
}

export function assertSafeRuleId(value: string): void {
    if (!RULE_ID_PATTERN.test(value)) invalid();
}

export function isPerformanceAction(value: string): value is PerformanceAction {
    return ACTIONS.includes(value as PerformanceAction);
}

export function canonicalObservedAction(
    value: unknown
): PerformanceAction | 'unknown' {
    const raw = typeof value === 'string' ? value : '';
    if (raw === '') return 'get_account_info';
    return isPerformanceAction(raw) ? raw : 'unknown';
}

function parseMatch(value: unknown): PerformanceRuleMatch {
    requireExactObject(value, [
        'scenario',
        'transport',
        'action',
        'occurrence',
        'categoryId',
    ]);
    const scenario = value['scenario'];
    const transport = value['transport'];
    const action = value['action'];
    const occurrence = value['occurrence'];
    const categoryId = value['categoryId'];

    if (scenario !== PERFORMANCE_SCENARIO) invalid();
    if (
        typeof transport !== 'string' ||
        !TRANSPORTS.includes(transport as PerformanceTransport)
    ) {
        invalid();
    }
    if (typeof action !== 'string' || !isPerformanceAction(action)) invalid();
    if (!Number.isInteger(occurrence) || (occurrence as number) <= 0) invalid();
    if (
        typeof categoryId !== 'string' ||
        !isAllowedPerformanceCategory(action, categoryId)
    ) {
        invalid();
    }

    return {
        scenario,
        transport: transport as PerformanceTransport,
        action,
        occurrence: occurrence as number,
        categoryId,
    };
}

export function isAllowedPerformanceCategory(
    action: PerformanceAction,
    categoryId: string
): boolean {
    if (categoryId === 'all') return true;
    if (!/^\d+$/.test(categoryId)) return false;
    const numericId = Number(categoryId);
    if (!Number.isSafeInteger(numericId) || categoryId !== String(numericId)) {
        return false;
    }
    if (action === 'get_live_streams') {
        return numericId >= 91_101 && numericId <= 91_160;
    }
    if (action === 'get_vod_streams') {
        return numericId >= 92_101 && numericId <= 92_120;
    }
    if (action === 'get_series') {
        return numericId >= 93_101 && numericId <= 93_120;
    }
    return false;
}

function requireExactObject(
    value: unknown,
    expectedKeys: readonly string[]
): asserts value is Record<string, unknown> {
    if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype
    ) {
        invalid();
    }
    const actualKeys = Object.keys(value).sort();
    const sortedExpected = [...expectedKeys].sort();
    if (
        actualKeys.length !== sortedExpected.length ||
        actualKeys.some((key, index) => key !== sortedExpected[index])
    ) {
        invalid();
    }
}

function invalid(): never {
    throw new PerformanceControlError(400, 'invalid-control-request');
}
