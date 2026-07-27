import type {
    XtreamCatalogCounts,
    XtreamControlState,
    XtreamLedgerEntry,
    XtreamOccurrence,
    XtreamPerformanceManifest,
} from './xtream-benchmark-contract';

const LIFECYCLE_STATUSES = [
    'aborted',
    'arrived',
    'blocked',
    'delayed',
    'responded',
] as const;
const STATE_KEYS = [
    'epoch',
    'prepared',
    'rules',
    'heldIds',
    'heldCount',
    'occurrences',
    'ledger',
] as const;
const MANIFEST_KEYS = [
    'epoch',
    'scenario',
    'seed',
    'counts',
    'bytes',
    'catalogSha256',
] as const;
const MAX_CONTROL_ARRAY_LENGTH = 4_096;

export function parseXtreamControlState(value: unknown): XtreamControlState {
    try {
        const input = snapshotExactRecord(value, STATE_KEYS);
        const heldIds = snapshotArray(input['heldIds']);
        const occurrences = snapshotArray(input['occurrences']).map(
            snapshotOccurrence
        );
        const ledger = snapshotArray(input['ledger']).map(snapshotLedger);
        const rules = snapshotArray(input['rules']).map((entry) =>
            snapshotJsonValue(entry, new WeakSet())
        );
        if (
            !isPositiveSafeInteger(input['epoch']) ||
            !heldIds.every((entry) => typeof entry === 'string') ||
            !isNonNegativeSafeInteger(input['heldCount']) ||
            input['heldCount'] !== heldIds.length
        ) {
            invalid();
        }
        const prepared =
            input['prepared'] === null
                ? null
                : snapshotManifest(input['prepared']);
        return freezeDeep({
            epoch: input['epoch'],
            prepared,
            rules,
            heldIds: heldIds as string[],
            heldCount: input['heldCount'],
            occurrences,
            ledger,
        }) as XtreamControlState;
    } catch {
        invalid();
    }
}

export function parseXtreamManifest(value: unknown): XtreamPerformanceManifest {
    try {
        return freezeDeep(snapshotManifest(value));
    } catch {
        throw invalidManifest();
    }
}

export function assertXtreamManifest(
    value: unknown
): asserts value is XtreamPerformanceManifest {
    parseXtreamManifest(value);
}

export function assertXtreamManifestIdentity(
    expected: XtreamPerformanceManifest,
    actual: unknown
): asserts actual is XtreamPerformanceManifest {
    const expectedSnapshot = parseXtreamManifest(expected);
    const actualSnapshot = parseXtreamManifest(actual);
    const identity = (manifest: XtreamPerformanceManifest) => [
        manifest.scenario,
        manifest.seed,
        manifest.counts,
        manifest.bytes,
        manifest.catalogSha256,
    ];
    if (
        JSON.stringify(identity(expectedSnapshot)) !==
        JSON.stringify(identity(actualSnapshot))
    ) {
        throw new Error('Xtream performance fixture identity changed');
    }
}

function snapshotManifest(value: unknown): XtreamPerformanceManifest {
    const input = snapshotExactRecord(value, MANIFEST_KEYS);
    const counts = snapshotExactRecord(input['counts'], [
        'categories',
        'items',
    ]);
    const categories = snapshotCounts(counts['categories'], [60, 20, 20, 100]);
    const items = snapshotCounts(
        counts['items'],
        [60_000, 20_000, 20_000, 100_000]
    );
    if (
        !isPositiveSafeInteger(input['epoch']) ||
        input['scenario'] !== 'performance-100k' ||
        input['seed'] !== 91_001 ||
        !isPositiveSafeInteger(input['bytes']) ||
        typeof input['catalogSha256'] !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(input['catalogSha256'])
    ) {
        throw invalidManifest();
    }
    return {
        epoch: input['epoch'],
        scenario: input['scenario'],
        seed: input['seed'],
        counts: { categories, items },
        bytes: input['bytes'],
        catalogSha256: input['catalogSha256'],
    };
}

function snapshotCounts(
    value: unknown,
    expected: readonly number[]
): XtreamCatalogCounts {
    const input = snapshotExactRecord(value, [
        'live',
        'vod',
        'series',
        'total',
    ]);
    const actual = [
        input['live'],
        input['vod'],
        input['series'],
        input['total'],
    ];
    if (actual.some((entry, index) => entry !== expected[index])) {
        throw invalidManifest();
    }
    return {
        live: input['live'] as number,
        vod: input['vod'] as number,
        series: input['series'] as number,
        total: input['total'] as number,
    };
}

function snapshotOccurrence(value: unknown): XtreamOccurrence {
    const input = snapshotExactRecord(value, [
        'scenario',
        'transport',
        'action',
        'categoryId',
        'count',
    ]);
    if (
        !['scenario', 'transport', 'action', 'categoryId'].every(
            (key) => typeof input[key] === 'string'
        ) ||
        !isPositiveSafeInteger(input['count'])
    ) {
        invalid();
    }
    return input as unknown as XtreamOccurrence;
}

function snapshotLedger(value: unknown): XtreamLedgerEntry {
    const input = snapshotExactRecord(value, [
        'scenario',
        'transport',
        'action',
        'categoryId',
        'epoch',
        'occurrence',
        'status',
        'atMs',
    ]);
    if (
        !['scenario', 'transport', 'action', 'categoryId'].every(
            (key) => typeof input[key] === 'string'
        ) ||
        typeof input['status'] !== 'string' ||
        !LIFECYCLE_STATUSES.includes(input['status'] as never) ||
        !isPositiveSafeInteger(input['epoch']) ||
        !isPositiveSafeInteger(input['occurrence']) ||
        !isFiniteNonNegative(input['atMs'])
    ) {
        invalid();
    }
    return input as unknown as XtreamLedgerEntry;
}

function snapshotExactRecord(
    value: unknown,
    expectedKeys: readonly string[]
): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        invalid();
    }
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== expectedKeys.length ||
        keys.some(
            (key) => typeof key !== 'string' || !expectedKeys.includes(key)
        )
    ) {
        invalid();
    }
    return Object.fromEntries(
        expectedKeys.map((key) => [key, Reflect.get(value, key)])
    );
}

function snapshotArray(value: unknown): unknown[] {
    if (!Array.isArray(value)) invalid();
    const length = Reflect.get(value, 'length') as unknown;
    if (
        !isNonNegativeSafeInteger(length) ||
        length > MAX_CONTROL_ARRAY_LENGTH
    ) {
        invalid();
    }
    const expected = new Set([
        'length',
        ...Array.from({ length }, (_, index) => String(index)),
    ]);
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== expected.size ||
        keys.some((key) => typeof key !== 'string' || !expected.has(key))
    ) {
        invalid();
    }
    return Array.from({ length }, (_, index) =>
        Reflect.get(value, String(index))
    );
}

function snapshotJsonValue(value: unknown, stack: WeakSet<object>): unknown {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    ) {
        return value;
    }
    if (typeof value !== 'object') invalid();
    if (stack.has(value)) invalid();
    stack.add(value);
    try {
        if (Array.isArray(value)) {
            return snapshotArray(value).map((entry) =>
                snapshotJsonValue(entry, stack)
            );
        }
        const keys = Reflect.ownKeys(value);
        if (keys.some((key) => typeof key !== 'string')) invalid();
        const input = snapshotExactRecord(value, keys as string[]);
        return Object.fromEntries(
            (keys as string[]).map((key) => [
                key,
                snapshotJsonValue(input[key], stack),
            ])
        );
    } finally {
        stack.delete(value);
    }
}

function freezeDeep<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freezeDeep);
        Object.freeze(value);
    }
    return value;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function invalid(): never {
    throw new Error('invalid control response');
}

function invalidManifest(): Error {
    return new Error('invalid Xtream performance manifest');
}
