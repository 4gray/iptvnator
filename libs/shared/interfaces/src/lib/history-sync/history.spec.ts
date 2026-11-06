import {
    applyHistoryOperation,
    emptyHistoryState,
    projectHistory,
    visibleHistory,
} from './history.reducer';
import {
    parseHistoryOperation,
    parseHistoryScope,
    assertHistoryState,
    assertHistoryRecord,
} from './history.validation';
import type {
    HistoryOperation,
    HistoryState,
    HistoryRecord,
} from './history.contract';
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
    it('keeps local watch times stable while pending watches stay optimistic', () => {
        const shared = { ...op('touch'), reference: { ...ref, id: '43' } };
        const pending = {
            ...op('touch'),
            reference: { ...ref, id: '44' },
            viewedAt: 50,
        };
        const record: HistoryRecord = {
            base: applyHistoryOperation(emptyHistoryState(), shared, false, 200)
                .state,
            pending: [],
            local: [op('touch')],
        };
        const rows = () =>
            visibleHistory(projectHistory(record)).map(
                ({ reference, viewedAt }) => [
                    reference.provider === 'm3u'
                        ? reference.urlHash
                        : reference.id,
                    viewedAt,
                ]
            );
        expect(rows()).toEqual([
            ['43', 200],
            ['42', 100],
        ]);
        record['base'] = applyHistoryOperation(
            record.base,
            shared,
            false,
            300
        ).state;
        expect(rows()).toEqual([
            ['43', 300],
            ['42', 100],
        ]);
        record['base'] = applyHistoryOperation(
            record.base,
            op('clear'),
            false,
            400
        ).state;
        record['pending'] = [{ consent: 'consent', operation: pending }];
        expect(rows()).toEqual([
            ['44', 301],
            ['42', 100],
        ]);
    });
    it('retains a newer shared watch of the same item without borrowing removal times', () => {
        const record: HistoryRecord = {
            base: applyHistoryOperation(
                emptyHistoryState(),
                op('touch'),
                false,
                300
            ).state,
            pending: [],
            local: [op('touch')],
        };
        expect(visibleHistory(projectHistory(record))[0].viewedAt).toBe(300);
        record['base'] = applyHistoryOperation(
            record.base,
            op('remove'),
            false,
            400
        ).state;
        expect(visibleHistory(projectHistory(record))[0].viewedAt).toBe(100);
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
    it.each([
        ['missing scope', () => parseHistoryScope(null)],
        [
            'unsupported command',
            () =>
                parseHistoryOperation({ ...op('touch'), kind: 'unsupported' }),
        ],
        [
            'unrepresentable date',
            () =>
                parseHistoryOperation({
                    ...op('touch'),
                    viewedAt: 8640000000000001,
                }),
        ],
        [
            'clear metadata',
            () =>
                parseHistoryOperation({
                    ...op('clear'),
                    snapshot: { title: 'Synthetic unexpected metadata' },
                }),
        ],
        ['missing state', () => assertHistoryState(null as never)],
        [
            'removal after revision',
            () =>
                assertHistoryState({
                    revision: 1,
                    cleared: 0,
                    items: [
                        {
                            reference: ref,
                            viewedAt: 1,
                            revision: 1,
                            removedAt: 2,
                            removed: false,
                        },
                    ],
                }),
        ],
        [
            'nonboolean removal',
            () =>
                assertHistoryState({
                    revision: 1,
                    cleared: 0,
                    items: [
                        {
                            reference: ref,
                            viewedAt: 1,
                            revision: 1,
                            removedAt: 0,
                            removed: 'yes',
                        },
                    ],
                } as never),
        ],
    ])('rejects untrusted %s payloads', (_name, validate) => {
        expect(validate).toThrow();
    });
    it.each([
        'base provider',
        'hideArchive',
        'archive',
        'pending',
        'local',
        'pending provider',
        'local provider',
        'archive provider',
    ])('rejects invalid persisted %s before accepting a record', (failure) => {
        const scope = {
            instanceId: 'synthetic-nas',
            sourceId: 'synthetic-source',
            sourceIncarnation: 'first',
            provider: 'xtream',
        } as const;
        const alien = {
            ...op('touch'),
            reference: { provider: 'm3u', version: 1, urlHash: 'a'.repeat(64) },
        };
        const record = {
            base: emptyHistoryState(),
            pending: [],
            local: [],
        } as unknown as Record<string, unknown>;
        if (failure === 'base provider')
            record['base'] = applyHistoryOperation(
                emptyHistoryState(),
                alien as HistoryOperation
            ).state;
        else if (failure === 'pending provider')
            record['pending'] = [
                { consent: 'synthetic-consent', operation: alien },
            ];
        else if (failure === 'local provider') record['local'] = [alien];
        else if (failure === 'archive provider') record['archive'] = [alien];
        else record[failure] = failure === 'hideArchive' ? 'unexpected' : {};
        expect(() =>
            assertHistoryRecord(scope, record as unknown as HistoryRecord)
        ).toThrow();
    });
});
