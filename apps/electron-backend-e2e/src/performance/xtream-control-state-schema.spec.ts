import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
    XtreamControlState,
    XtreamPerformanceManifest,
} from './xtream-benchmark-contract';
import { parseXtreamControlState } from './xtream-control-state-schema';

const MANIFEST: XtreamPerformanceManifest = {
    epoch: 1,
    scenario: 'performance-100k',
    seed: 91_001,
    counts: {
        categories: { live: 60, vod: 20, series: 20, total: 100 },
        items: {
            live: 60_000,
            vod: 20_000,
            series: 20_000,
            total: 100_000,
        },
    },
    bytes: 100,
    catalogSha256:
        'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
};
const OCCURRENCE = {
    scenario: 'performance-100k',
    transport: 'direct',
    action: 'get_account_info',
    categoryId: 'all',
    count: 1,
};
const LEDGER = {
    scenario: 'performance-100k',
    transport: 'direct',
    action: 'get_account_info',
    categoryId: 'all',
    epoch: 1,
    occurrence: 1,
    status: 'arrived',
    atMs: 1,
};

describe('Xtream control-state exact schema', () => {
    it('requires exact occurrence and ledger records with known lifecycle states', () => {
        const populated = state();
        assert.doesNotThrow(() => parseXtreamControlState(populated));

        for (const invalid of [
            {
                ...populated,
                occurrences: [{ ...OCCURRENCE, injected: true }],
            },
            {
                ...populated,
                ledger: [{ ...LEDGER, injected: true }],
            },
            {
                ...populated,
                ledger: [{ ...LEDGER, status: 'completed' }],
            },
        ]) {
            assert.throws(
                () => parseXtreamControlState(invalid),
                /^Error: invalid control response$/
            );
        }
    });

    it('returns a stable deep-frozen snapshot of nested accessor values', () => {
        let epoch = 1;
        let manifestBytes = MANIFEST.bytes;
        let occurrenceAction = OCCURRENCE.action;
        let ledgerStatus = LEDGER.status;
        const input = withAccessor(
            {
                ...state(),
                prepared: withAccessor(
                    { ...MANIFEST },
                    'bytes',
                    () => manifestBytes
                ),
                occurrences: [
                    withAccessor(
                        { ...OCCURRENCE },
                        'action',
                        () => occurrenceAction
                    ),
                ],
                ledger: [
                    withAccessor({ ...LEDGER }, 'status', () => ledgerStatus),
                ],
            },
            'epoch',
            () => epoch
        );

        const parsed = parseXtreamControlState(input);
        epoch = 2;
        manifestBytes = 0;
        occurrenceAction = 'unknown';
        ledgerStatus = 'completed';

        assert.equal(parsed.epoch, 1);
        assert.equal(parsed.prepared?.bytes, MANIFEST.bytes);
        assert.equal(parsed.occurrences[0]?.action, 'get_account_info');
        assert.equal(parsed.ledger[0]?.status, 'arrived');
        assert.ok(Object.isFrozen(parsed));
        assert.ok(Object.isFrozen(parsed.prepared));
        assert.ok(Object.isFrozen(parsed.prepared?.counts));
        assert.ok(Object.isFrozen(parsed.occurrences));
        assert.ok(Object.isFrozen(parsed.occurrences[0]));
        assert.ok(Object.isFrozen(parsed.ledger));
        assert.ok(Object.isFrozen(parsed.ledger[0]));
    });

    it('sanitizes proxy and nested getter failures', () => {
        const secret = 'must-not-escape-control-state';
        const proxy = new Proxy(
            {},
            {
                ownKeys() {
                    throw new Error(secret);
                },
            }
        );
        const nested = state();
        Object.defineProperty(nested.prepared, 'bytes', {
            enumerable: true,
            get() {
                throw new Error(secret);
            },
        });

        for (const invalid of [proxy, nested]) {
            assert.throws(
                () => parseXtreamControlState(invalid),
                (error: unknown) =>
                    error instanceof Error &&
                    error.message === 'invalid control response' &&
                    !error.message.includes(secret)
            );
        }
    });
});

function state(): XtreamControlState {
    return {
        epoch: 1,
        prepared: structuredClone(MANIFEST),
        rules: [],
        heldIds: [],
        heldCount: 0,
        occurrences: [{ ...OCCURRENCE }],
        ledger: [{ ...LEDGER }],
    };
}

function withAccessor<T extends object, K extends keyof T>(
    value: T,
    key: K,
    get: () => T[K]
): T {
    Object.defineProperty(value, key, { enumerable: true, get });
    return value;
}
