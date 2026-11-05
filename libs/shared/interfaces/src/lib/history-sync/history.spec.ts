import {
    applyHistoryOperation,
    emptyHistoryState,
    visibleHistory,
} from './history.reducer';
import {
    parseHistoryOperation,
    parseHistoryScope,
    assertHistoryState,
    assertHistoryRecord,
} from './history.validation';
import type { HistoryOperation, HistoryState } from './history.contract';
const ref = { provider: 'xtream' as const, kind: 'movie' as const, id: '42' };
const op = (
    kind: HistoryOperation['kind'],
    baseRevision = 0
): HistoryOperation => ({
    operationId: kind,
    deviceId: 'device',
    kind,
    baseRevision,
    viewedAt: 100,
    ...(kind === 'clear' ? {} : { reference: ref }),
});
describe('history barriers and validation', () => {
    it('does not turn absent history into removal; repeated touches move one entry', () => {
        let state = emptyHistoryState();
        state = applyHistoryOperation(state, op('touch')).state;
        state = applyHistoryOperation(
            state,
            { ...op('touch'), reference: { ...ref, id: '43' } },
            false,
            200
        ).state;
        state = applyHistoryOperation(state, op('touch'), false, 300).state;
        expect(visibleHistory(state).map((item) => item.reference)).toEqual([
            ref,
            { ...ref, id: '43' },
        ]);
    });
    it.each(['remove', 'clear'] as const)(
        'keeps a stale watch behind a durable %s barrier',
        (kind) => {
            const watched = applyHistoryOperation(
                emptyHistoryState(),
                op('touch')
            ).state;
            const removed = applyHistoryOperation(watched, op(kind, 1)).state;
            expect(visibleHistory(removed)).toEqual([]);
            expect(applyHistoryOperation(removed, op('touch')).applied).toBe(
                false
            );
            expect(
                visibleHistory(
                    applyHistoryOperation(
                        removed,
                        op('touch', removed.revision)
                    ).state
                )
            ).toHaveLength(1);
        }
    );
    it('retains local optimistic choices without granting server authority', () => {
        const cleared = applyHistoryOperation(
            emptyHistoryState(),
            op('clear')
        ).state;
        expect(applyHistoryOperation(cleared, op('touch')).applied).toBe(false);
        expect(
            visibleHistory(
                applyHistoryOperation(cleared, op('touch'), true).state
            )
        ).toHaveLength(1);
    });
    it('bounds wire metadata and rejects unsafe scopes/references', () => {
        expect(() =>
            parseHistoryScope({
                instanceId: 'nas',
                sourceId: 'source',
                sourceIncarnation: 'v1',
                provider: 'unknown',
            })
        ).toThrow();
        expect(() =>
            parseHistoryOperation({
                ...op('touch'),
                reference: {
                    provider: 'm3u',
                    url: 'https://synthetic.invalid/secret',
                },
            })
        ).toThrow();
        expect(() =>
            parseHistoryOperation({
                ...op('touch'),
                snapshot: { title: 'x'.repeat(513) },
            })
        ).toThrow();
        expect(
            parseHistoryOperation({
                ...op('touch'),
                snapshot: {
                    title: 'https://synthetic.invalid/private',
                    tmdbId: '42',
                },
            }).snapshot
        ).toEqual({ tmdbId: '42' });
        expect(() =>
            parseHistoryOperation({ ...op('clear'), reference: ref })
        ).toThrow();
        expect(() =>
            parseHistoryOperation({ ...op('touch'), baseRevision: -1 })
        ).toThrow();
        const state = applyHistoryOperation(
            emptyHistoryState(),
            op('touch')
        ).state;
        expect(() =>
            assertHistoryState({
                ...state,
                items: [...state.items, ...state.items],
            })
        ).toThrow();
        expect(() =>
            assertHistoryRecord(
                {
                    instanceId: 'nas',
                    sourceId: 'source',
                    sourceIncarnation: 'v1',
                    provider: 'm3u',
                },
                { base: emptyHistoryState(), local: [op('touch')], pending: [] }
            )
        ).toThrow();
        expect(() => assertHistoryState({ ...state, cleared: 10 })).toThrow();
        expect(() =>
            applyHistoryOperation(
                { ...state, revision: Number.MAX_SAFE_INTEGER },
                op('touch')
            )
        ).toThrow();
    });
});
