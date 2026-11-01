import { activityAddressKey } from './activity-sync.identity';
import {
    applyActivityOperation,
    emptyActivityState,
} from './activity-sync.reducer';
import { appendActivityIntent } from './activity-sync.local';
import type {
    ActivityAddress,
    ActivityOperation,
    ActivityState,
} from './activity-sync.contract';

const address: ActivityAddress = {
    instanceId: 'nas',
    scope: 'shared',
    sourceId: 'source',
    sourceIncarnation: 'first',
    content: { provider: 'xtream', kind: 'vod', id: '42' },
};
const begin: Extract<ActivityOperation, { kind: 'begin' }> = {
    kind: 'begin',
    operationId: 'begin',
    deviceId: 'desktop',
    expectedRevision: 0,
    sessionId: 'session',
};
const checkpoint: Extract<ActivityOperation, { kind: 'checkpoint' }> = {
    kind: 'checkpoint',
    operationId: 'tick',
    deviceId: 'desktop',
    generation: 1,
    sessionId: 'session',
    sequence: 1,
    resume: { positionSeconds: 25, durationSeconds: 100 },
};

function applied(
    state: ActivityState,
    operation: ActivityOperation
): ActivityState {
    const result = applyActivityOperation(state, operation);
    expect(result.status).toBe('applied');
    return result.state;
}

describe('activity address', () => {
    it.each([
        { instanceId: 'other' },
        { sourceId: 'other' },
        { sourceIncarnation: 'replacement' },
        { content: { provider: 'stalker', kind: 'vod', id: '42' } },
        {
            content: {
                provider: 'xtream',
                kind: 'episode',
                seriesId: '3',
                id: '42',
            },
        },
    ])('keeps independent namespaces for %j', (patch) => {
        expect(
            activityAddressKey({ ...address, ...patch } as ActivityAddress)
        ).not.toBe(activityAddressKey(address));
    });

    it('includes the Stalker mode, parent, season and episode without hashing them', () => {
        const episode: ActivityAddress = {
            ...address,
            content: {
                provider: 'stalker',
                kind: 'episode',
                mode: 'lazy',
                seriesId: 'series',
                id: 'episode',
                seasonKey: 'season',
                episodeNumber: 1,
            },
        };
        for (const patch of [
            { mode: 'regular' },
            { mode: 'embedded' },
            { seriesId: 'other' },
            { seasonKey: 'other' },
            { episodeNumber: 2 },
        ]) {
            expect(
                activityAddressKey({
                    ...episode,
                    content: { ...episode.content, ...patch },
                } as ActivityAddress)
            ).not.toBe(activityAddressKey(episode));
        }
    });

    it('ignores property order and extra snapshot fields but escapes separators', () => {
        expect(
            activityAddressKey({
                ...address,
                content: {
                    id: '42',
                    kind: 'vod',
                    provider: 'xtream',
                    title: 'ignored',
                },
            } as ActivityAddress)
        ).toBe(activityAddressKey(address));
        expect(
            activityAddressKey({
                ...address,
                sourceId: 'a:b',
                sourceIncarnation: 'c',
            })
        ).not.toBe(
            activityAddressKey({
                ...address,
                sourceId: 'a',
                sourceIncarnation: 'b:c',
            })
        );
    });

    it.each(['', ' bad', 'bad ', 'bad\nkey', 'x'.repeat(1025)])(
        'rejects invalid IDs',
        (id) => {
            expect(() =>
                activityAddressKey({ ...address, sourceId: id })
            ).toThrow();
        }
    );

    it('rejects unsupported identity shapes rather than guessing', () => {
        expect(() =>
            activityAddressKey({ ...address, scope: 'person' } as never)
        ).toThrow();
        expect(() =>
            activityAddressKey({
                ...address,
                content: { provider: 'm3u', kind: 'vod', id: 'x' },
            } as never)
        ).toThrow();
        expect(() =>
            activityAddressKey({
                ...address,
                content: { provider: 'xtream', kind: 'series', id: 'x' },
            } as never)
        ).toThrow();
        expect(() =>
            activityAddressKey({
                ...address,
                content: {
                    provider: 'xtream',
                    kind: 'episode',
                    id: 'x',
                    seriesId: '',
                },
            } as never)
        ).toThrow();
        for (const patch of [
            { mode: 'unknown' },
            { episodeNumber: -1 },
            { seasonKey: '' },
        ]) {
            expect(() =>
                activityAddressKey({
                    ...address,
                    content: {
                        provider: 'stalker',
                        kind: 'episode',
                        mode: 'lazy',
                        seriesId: 's',
                        id: 'e',
                        seasonKey: '1',
                        episodeNumber: 1,
                        ...patch,
                    },
                } as never)
            ).toThrow();
        }
    });
});

describe('activity session reducer', () => {
    const started = () => applied(emptyActivityState(), begin);

    it('allows a deliberate rewind; the maximum position is not the resume point', () => {
        const state = applied(started(), checkpoint);
        const next = applied(state, {
            ...checkpoint,
            sequence: 2,
            resume: { positionSeconds: 12 },
        });
        expect(next.resume).toEqual({ positionSeconds: 12 });
        expect(state.resume).toEqual({
            positionSeconds: 25,
            durationSeconds: 100,
        });
    });

    it('lets a later explicit begin own shared resume without mutating the old state', () => {
        const state = applied(started(), checkpoint);
        const next = applied(state, {
            ...begin,
            deviceId: 'phone',
            sessionId: 'phone',
            expectedRevision: 2,
        });
        expect(next.owner?.deviceId).toBe('phone');
        expect(next.generation).toBe(2);
        expect(
            applyActivityOperation(next, { ...checkpoint, sequence: 2 })
        ).toEqual({ status: 'conflict', reason: 'session', state: next });
        expect(state.owner?.deviceId).toBe('desktop');
    });

    it.each([{ deviceId: 'other' }, { sessionId: 'other' }, { generation: 0 }])(
        'rejects checkpoints owned by another session: %j',
        (patch) => {
            expect(
                applyActivityOperation(started(), { ...checkpoint, ...patch })
                    .status
            ).toBe('conflict');
        }
    );

    it('rejects out-of-order sequence even when its position is further ahead', () => {
        const state = applied(started(), { ...checkpoint, sequence: 3 });
        expect(
            applyActivityOperation(state, {
                ...checkpoint,
                sequence: 2,
                resume: { positionSeconds: 99 },
            })
        ).toEqual({ status: 'conflict', reason: 'sequence', state });
    });

    it('keeps a durable reset barrier and allows a genuinely new playback afterwards', () => {
        const state = applied(started(), {
            ...checkpoint,
            resume: { positionSeconds: 100, durationSeconds: 100 },
        });
        const reset = applied(state, {
            kind: 'reset',
            operationId: 'reset',
            deviceId: 'phone',
            expectedRevision: 2,
        });
        expect(reset).toMatchObject({
            revision: 3,
            generation: 2,
            owner: null,
            resume: null,
            watched: false,
            watchedOrigin: null,
        });
        expect(
            applyActivityOperation(reset, { ...checkpoint, sequence: 9 }).status
        ).toBe('conflict');
        const restarted = applied(reset, { ...begin, expectedRevision: 3 });
        expect(
            applied(restarted, { ...checkpoint, generation: 3 }).resume
                ?.positionSeconds
        ).toBe(25);
    });

    it.each(['begin', 'mark-watched', 'reset'] as const)(
        'requires an explicit choice for a stale %s',
        (kind) => {
            const state = started();
            const operation = { ...begin, kind } as ActivityOperation;
            expect(applyActivityOperation(state, operation)).toEqual({
                status: 'conflict',
                reason: 'revision',
                state,
            });
        }
    );

    it.each([
        [89, false],
        [895, true],
        [90, true],
        [100, true],
    ] as const)(
        'preserves the existing rounded 90%% rule for %s',
        (position, watched) => {
            const duration = position === 895 ? 1000 : 100;
            expect(
                applied(started(), {
                    ...checkpoint,
                    resume: {
                        positionSeconds: position,
                        durationSeconds: duration,
                    },
                }).watched
            ).toBe(watched);
        }
    );

    it('supports unknown-duration resume and manual watched without inventing runtime', () => {
        const state = applied(started(), {
            ...checkpoint,
            resume: { positionSeconds: 300 },
        });
        expect(state.watched).toBe(false);
        const marked = applied(state, {
            kind: 'mark-watched',
            expectedRevision: 2,
            operationId: 'mark',
            deviceId: 'phone',
        });
        expect(marked.watchedOrigin).toBe('manual');
        expect(marked.resume).toEqual({ positionSeconds: 300 });
        expect(marked.owner).toBeNull();
        expect(
            applyActivityOperation(marked, { ...checkpoint, sequence: 2 })
                .status
        ).toBe('conflict');
        const restarted = applied(marked, { ...begin, expectedRevision: 3 });
        expect(
            applied(restarted, { ...checkpoint, generation: 3 }).watchedOrigin
        ).toBe('manual');
    });

    it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid positions %s',
        (positionSeconds) => {
            expect(() =>
                applyActivityOperation(started(), {
                    ...checkpoint,
                    resume: { positionSeconds },
                })
            ).toThrow();
        }
    );

    it('rejects zero duration, invalid commands and counter overflow', () => {
        expect(() =>
            applyActivityOperation(started(), {
                ...checkpoint,
                resume: { positionSeconds: 3, durationSeconds: 0 },
            })
        ).toThrow();
        expect(() =>
            applyActivityOperation(started(), {
                ...begin,
                kind: 'unknown',
            } as never)
        ).toThrow();
        expect(() =>
            applyActivityOperation(
                { ...emptyActivityState(), revision: Number.MAX_SAFE_INTEGER },
                { ...begin, expectedRevision: Number.MAX_SAFE_INTEGER }
            )
        ).toThrow();
    });
});

describe('local intent boundary', () => {
    const pending = {
        address,
        consentGeneration: 'consent-1',
        operation: begin,
    };
    it('retains operation order and consent while storing the next local state', () => {
        const state = emptyActivityState();
        const first = appendActivityIntent(null, state, pending);
        const second = appendActivityIntent(first, state, {
            ...pending,
            operation: { ...begin, operationId: 'later' },
        });
        expect(
            second.pending.map((entry) => entry.operation.operationId)
        ).toEqual(['begin', 'later']);
        expect(first.pending).toHaveLength(1);
        expect(second.pending[0].consentGeneration).toBe('consent-1');
    });
    it('rejects mixed profiles, duplicate IDs and missing consent', () => {
        const first = appendActivityIntent(null, emptyActivityState(), pending);
        expect(() => appendActivityIntent(first, first.state, pending)).toThrow(
            'Duplicate'
        );
        expect(() =>
            appendActivityIntent(first, first.state, {
                ...pending,
                address: { ...address, instanceId: 'other' },
            })
        ).toThrow('address mismatch');
        expect(() =>
            appendActivityIntent(null, first.state, {
                ...pending,
                consentGeneration: '',
            })
        ).toThrow();
    });
});
