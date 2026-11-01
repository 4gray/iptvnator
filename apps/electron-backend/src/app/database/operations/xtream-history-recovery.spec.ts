import {
    createDbMock,
    mockDrizzleOrmModule,
    resetDrizzleMocks,
} from './operations.test-helpers';
jest.mock('drizzle-orm', () => mockDrizzleOrmModule());
import {
    beginHistoryRecovery,
    clearRecoveredHistory,
    deleteHistoryRecovery,
    readHistoryRecovery,
    recordRecoveredHistory,
    removeRecoveredHistory,
    replayRecoveredHistory,
} from './xtream-history-recovery';
import { XtreamHistoryRecovery } from '@iptvnator/shared/interfaces';

const entry = (xtreamId: number, viewedAt = '2026-01-01') => ({
    contentType: 'movie' as const,
    xtreamId,
    viewedAt,
});
const state = (rows = [entry(1)]): XtreamHistoryRecovery => ({
    version: 1,
    contentTypes: ['movie'],
    recentlyViewed: rows,
});
const record = (value = state()) => ({
    key: 'xtream-history-recovery:p',
    value: JSON.stringify(value),
});
beforeEach(resetDrizzleMocks);

it('distinguishes absent journals from corrupt state', () => {
    expect(readHistoryRecovery(createDbMock().db, 'p')).toBeNull();
    expect(
        readHistoryRecovery(createDbMock([[{ value: '' }]]).db, 'p')
    ).toBeNull();
    expect(readHistoryRecovery(createDbMock([[record()]]).db, 'p')).toEqual(
        state()
    );
    expect(() =>
        readHistoryRecovery(createDbMock([[{ value: '{' }]]).db, 'p')
    ).toThrow();
});

it('registers live history atomically and does not reintroduce explicitly removed archives', () => {
    const previous = {
        ...state([entry(1)]),
        contentTypes: ['movie' as const],
        removed: [{ contentType: 'movie' as const, xtreamId: 2 }],
    };
    const { db, insertValues, transaction } = createDbMock([
        [record(previous)],
        [entry(1, 'new'), entry(3)],
    ]);
    beginHistoryRecovery(db, 'p', {
        version: 1,
        contentTypes: ['movie', 'live'],
        recentlyViewed: [
            entry(2),
            { contentType: 'live', xtreamId: 4, viewedAt: 'archive' },
        ],
    });
    const written = JSON.parse(insertValues.mock.calls[0][0].value);
    expect(written).toEqual({
        version: 1,
        contentTypes: ['movie', 'live'],
        removed: previous.removed,
        recentlyViewed: expect.arrayContaining([
            entry(1, 'new'),
            entry(3),
            { contentType: 'live', xtreamId: 4, viewedAt: 'archive' },
        ]),
    });
    expect(written.recentlyViewed).toHaveLength(3);
    expect(transaction).toHaveBeenCalledTimes(1);
});

it('registers a fresh snapshot and supplies legacy null timestamps', () => {
    const { db, insertValues } = createDbMock([
        [],
        [{ ...entry(1), viewedAt: null }],
    ]);
    beginHistoryRecovery(db, 'p', state([entry(2)]));
    const written = JSON.parse(insertValues.mock.calls[0][0].value);
    expect(written.recentlyViewed).toEqual([
        entry(2),
        expect.objectContaining({ xtreamId: 1, viewedAt: expect.any(String) }),
    ]);
});

it('does not resurrect removed or cleared archives when another catalog becomes available', () => {
    const previous = {
        ...state([]),
        removed: [{ contentType: 'live' as const, xtreamId: 10 }],
    };
    const incoming: XtreamHistoryRecovery = {
        version: 1,
        contentTypes: ['live'],
        recentlyViewed: [
            { contentType: 'live', xtreamId: 10, viewedAt: 'old' },
        ],
    };
    for (const value of [
        previous,
        { ...previous, cleared: true as const, removed: [] },
    ]) {
        const { db, insertValues } = createDbMock([[record(value)], []]);
        beginHistoryRecovery(db, 'p', incoming);
        expect(
            JSON.parse(insertValues.mock.calls[0][0].value).recentlyViewed
        ).toEqual([]);
    }
    const watched = createDbMock([
        [
            record({
                ...previous,
                recentlyViewed: [entry(1)],
                removed: [{ contentType: 'movie', xtreamId: 1 }],
            }),
        ],
        [entry(1, 'again')],
    ]);
    recordRecoveredHistory(watched.db, 'p', 10);
    expect(
        JSON.parse(watched.insertValues.mock.calls[0][0].value).removed
    ).toEqual([]);
});

it('records current watch timestamps without duplicating identities', () => {
    const { db, insertValues } = createDbMock([[record()], [entry(1, 'new')]]);
    recordRecoveredHistory(db, 'p', 10);
    expect(
        JSON.parse(insertValues.mock.calls[0][0].value).recentlyViewed
    ).toEqual([entry(1, 'new')]);
    expect(JSON.parse(insertValues.mock.calls[0][0].value).resolved).toEqual([
        { contentType: 'movie', xtreamId: 1 },
    ]);
    const missing = createDbMock();
    recordRecoveredHistory(missing.db, 'p', 10);
    expect(missing.insertValues).not.toHaveBeenCalled();
    const noRow = createDbMock([[record()], []]);
    recordRecoveredHistory(noRow.db, 'p', 10);
    expect(noRow.insertValues).not.toHaveBeenCalled();
});

it('removes single and batched identities per source, leaving an absent source alone', () => {
    const { db, insertValues } = createDbMock([
        [
            record({
                ...state([entry(1), entry(2)]),
                resolved: [
                    { contentType: 'movie', xtreamId: 1 },
                    { contentType: 'movie', xtreamId: 2 },
                ],
            }),
        ],
        [entry(1), entry(2)],
        [],
    ]);
    removeRecoveredHistory(db, [
        { playlistId: 'p', contentId: 10 },
        { playlistId: 'p', contentId: 20 },
        { playlistId: 'q', contentId: 30 },
    ]);
    expect(
        JSON.parse(insertValues.mock.calls[0][0].value).recentlyViewed
    ).toEqual([]);
    expect(insertValues).toHaveBeenCalledTimes(1);
});

it('clears one journal or every nonempty journal without deleting ownership', () => {
    const scoped = createDbMock([[record()]]);
    clearRecoveredHistory(scoped.db, 'p');
    expect(JSON.parse(scoped.insertValues.mock.calls[0][0].value)).toEqual({
        ...state([]),
        cleared: true,
        removed: [],
    });
    const missing = createDbMock();
    clearRecoveredHistory(missing.db, 'p');
    expect(missing.insertValues).not.toHaveBeenCalled();
    const global = createDbMock([
        [record(), { key: 'xtream-history-recovery:q', value: '' }],
    ]);
    clearRecoveredHistory(global.db);
    expect(JSON.parse(global.insertValues.mock.calls[0][0].value)).toEqual({
        ...state([]),
        cleared: true,
        removed: [],
    });
});

it('atomically replays the current journal with fresh content identities and retains it until acknowledgement', () => {
    const { db, insertValues, deleteFn, transaction } = createDbMock([
        [
            record({
                ...state([entry(1), entry(2)]),
                resolved: [
                    { contentType: 'movie', xtreamId: 1 },
                    { contentType: 'movie', xtreamId: 2 },
                ],
            }),
        ],
        [{ id: 99, contentType: 'movie', xtreamId: 1 }],
    ]);
    expect(replayRecoveredHistory(db, 'p')).toBe(1);
    expect(insertValues).toHaveBeenCalledWith([
        { contentId: 99, playlistId: 'p', viewedAt: '2026-01-01' },
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteFn).toHaveBeenCalledTimes(1);
    const journal = insertValues.mock.calls.find(([value]) => value.key)?.[0];
    expect(JSON.parse(journal.value).resolved).toEqual([
        { contentType: 'movie', xtreamId: 1 },
    ]);
    expect(replayRecoveredHistory(createDbMock().db, 'p')).toBeNull();
    const empty = createDbMock([[record(state([]))]]);
    expect(replayRecoveredHistory(empty.db, 'p')).toBe(0);
    expect(
        empty.insertValues.mock.calls.some(([value]) => Array.isArray(value))
    ).toBe(false);
    expect(
        JSON.parse(empty.insertValues.mock.calls[0][0].value).resolved
    ).toEqual([]);
});

it('deletes recovery data when the source or whole library is deleted', () => {
    const scoped = createDbMock();
    deleteHistoryRecovery(scoped.db, 'p');
    expect(scoped.deleteRun).toHaveBeenCalledTimes(1);
    const global = createDbMock();
    deleteHistoryRecovery(global.db);
    expect(global.deleteRun).toHaveBeenCalledTimes(1);
});
