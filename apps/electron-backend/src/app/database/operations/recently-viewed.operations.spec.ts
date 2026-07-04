const andMock = jest.fn((...conditions: unknown[]) => ({
    kind: 'and',
    conditions,
}));
const eqMock = jest.fn((left: unknown, right: unknown) => ({
    kind: 'eq',
    left,
    right,
}));
const descMock = jest.fn((value: unknown) => ({ kind: 'desc', value }));
const inArrayMock = jest.fn((left: unknown, values: unknown[]) => ({
    kind: 'inArray',
    left,
    values,
}));
const sqlMock = Object.assign(
    jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
        kind: 'sql',
        strings: Array.from(strings),
        values,
    })),
    {
        placeholder: jest.fn((name: string) => ({
            kind: 'placeholder',
            name,
        })),
    }
);

jest.mock('drizzle-orm', () => ({
    and: (...conditions: unknown[]) => andMock(...conditions),
    desc: (value: unknown) => descMock(value),
    eq: (left: unknown, right: unknown) => eqMock(left, right),
    inArray: (left: unknown, values: unknown[]) => inArrayMock(left, values),
    sql: sqlMock,
}));

jest.mock('./content-backdrop.operations', () => ({
    persistContentBackdropIfMissing: jest.fn().mockResolvedValue(undefined),
}));

import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { persistContentBackdropIfMissing } from './content-backdrop.operations';
import {
    addRecentItem,
    clearPlaylistRecentItems,
    clearRecentlyViewed,
    getRecentItems,
    getRecentlyViewed,
    removeRecentItem,
    removeRecentItemsBatch,
} from './recently-viewed.operations';

type QueryMock = {
    from: jest.Mock;
    innerJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    then: (
        resolve: (value: unknown[]) => void,
        reject: (reason: unknown) => void
    ) => Promise<void>;
};

function createDbMock(selectResultsByCall: unknown[][] = []) {
    let selectIndex = 0;
    const queries: QueryMock[] = [];
    const select = jest.fn(() => {
        const rows = selectResultsByCall[selectIndex] ?? [];
        selectIndex += 1;
        const query: QueryMock = {
            from: jest.fn(),
            innerJoin: jest.fn(),
            where: jest.fn(),
            orderBy: jest.fn(),
            limit: jest.fn().mockResolvedValue(rows),
            then: (resolve, reject) =>
                Promise.resolve(rows).then(resolve, reject),
        };
        query.from.mockReturnValue(query);
        query.innerJoin.mockReturnValue(query);
        query.where.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        queries.push(query);
        return query;
    });

    const insertValues = jest.fn().mockResolvedValue(undefined);
    const insert = jest.fn().mockReturnValue({ values: insertValues });

    const updateWhere = jest.fn().mockResolvedValue(undefined);
    const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set: updateSet });

    const deleteExecute = jest.fn().mockResolvedValue(undefined);
    const deletePrepare = jest
        .fn()
        .mockReturnValue({ execute: deleteExecute });
    const deleteResult = {
        prepare: deletePrepare,
        then: (
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void
        ) => Promise.resolve(undefined).then(resolve, reject),
    };
    const deleteWhere = jest.fn().mockReturnValue(deleteResult);
    const deleteFn = jest.fn().mockReturnValue({
        where: deleteWhere,
        then: (
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void
        ) => Promise.resolve(undefined).then(resolve, reject),
    });

    const transaction = jest.fn((callback: () => unknown) => {
        const result = callback();
        return Promise.resolve(result);
    });

    return {
        db: {
            select,
            insert,
            update,
            delete: deleteFn,
            transaction,
        } as unknown as AppDatabase,
        deleteExecute,
        deleteFn,
        deletePrepare,
        deleteWhere,
        insert,
        insertValues,
        queries,
        select,
        transaction,
        update,
        updateSet,
    };
}

describe('recently-viewed.operations', () => {
    beforeEach(() => {
        andMock.mockClear();
        descMock.mockClear();
        eqMock.mockClear();
        inArrayMock.mockClear();
        sqlMock.mockClear();
        sqlMock.placeholder.mockClear();
        (persistContentBackdropIfMissing as jest.Mock).mockClear();
    });

    describe('reading recent items', () => {
        it('returns the global history newest-first capped at 100 entries', async () => {
            const rows = [
                { id: 2, title: 'Newest', viewed_at: '2026-07-02 10:00:00' },
                { id: 1, title: 'Older', viewed_at: '2026-07-01 10:00:00' },
            ];
            const { db, queries } = createDbMock([rows]);

            await expect(getRecentlyViewed(db)).resolves.toEqual(rows);

            expect(descMock).toHaveBeenCalledWith(
                schema.recentlyViewed.viewedAt
            );
            expect(queries[0].orderBy).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'desc' })
            );
            expect(queries[0].limit).toHaveBeenCalledWith(100);
            expect(queries[0].innerJoin).toHaveBeenCalledTimes(3);
        });

        it('scopes playlist history to the playlist, newest-first with a 100 cap', async () => {
            const rows = [{ id: 5, title: 'Recent Movie' }];
            const { db, queries } = createDbMock([rows]);

            await expect(getRecentItems(db, 'playlist-1')).resolves.toEqual(
                rows
            );

            expect(eqMock).toHaveBeenCalledWith(
                schema.recentlyViewed.playlistId,
                'playlist-1'
            );
            expect(descMock).toHaveBeenCalledWith(
                schema.recentlyViewed.viewedAt
            );
            expect(queries[0].limit).toHaveBeenCalledWith(100);
        });
    });

    describe('addRecentItem', () => {
        it('inserts a new history entry on first view and persists the backdrop', async () => {
            const { db, insert, insertValues, update } = createDbMock([[]]);

            await expect(
                addRecentItem(db, 42, 'playlist-1', {
                    backdropUrl: 'https://example.com/backdrop.jpg',
                })
            ).resolves.toEqual({ success: true });

            expect(insert).toHaveBeenCalledWith(schema.recentlyViewed);
            expect(insertValues).toHaveBeenCalledWith({
                contentId: 42,
                playlistId: 'playlist-1',
            });
            expect(update).not.toHaveBeenCalled();
            expect(persistContentBackdropIfMissing).toHaveBeenCalledWith(
                db,
                42,
                'https://example.com/backdrop.jpg'
            );
        });

        it('refreshes viewedAt for an already-tracked item instead of duplicating it', async () => {
            const { db, insert, update, updateSet } = createDbMock([
                [{ id: 9, contentId: 42, playlistId: 'playlist-1' }],
            ]);

            await expect(
                addRecentItem(db, 42, 'playlist-1')
            ).resolves.toEqual({ success: true });

            expect(insert).not.toHaveBeenCalled();
            expect(update).toHaveBeenCalledWith(schema.recentlyViewed);
            expect(updateSet).toHaveBeenCalledWith({
                viewedAt: expect.objectContaining({ kind: 'sql' }),
            });
            expect(sqlMock).toHaveBeenCalledWith(['CURRENT_TIMESTAMP']);
            expect(eqMock).toHaveBeenCalledWith(
                schema.recentlyViewed.contentId,
                42
            );
            expect(eqMock).toHaveBeenCalledWith(
                schema.recentlyViewed.playlistId,
                'playlist-1'
            );
            expect(persistContentBackdropIfMissing).toHaveBeenCalledWith(
                db,
                42,
                undefined
            );
        });
    });

    describe('clearing history', () => {
        it('wipes the whole history table for the global clear', async () => {
            const { db, deleteFn, deleteWhere } = createDbMock();

            await expect(clearRecentlyViewed(db)).resolves.toEqual({
                success: true,
            });

            expect(deleteFn).toHaveBeenCalledWith(schema.recentlyViewed);
            expect(deleteWhere).not.toHaveBeenCalled();
        });

        it('deletes only entries belonging to the playlist content ids', async () => {
            const { db, deleteFn, deleteWhere } = createDbMock([
                [{ id: 11 }, { id: 12 }],
            ]);

            await expect(
                clearPlaylistRecentItems(db, 'playlist-1')
            ).resolves.toEqual({ success: true });

            expect(eqMock).toHaveBeenCalledWith(
                schema.categories.playlistId,
                'playlist-1'
            );
            expect(deleteFn).toHaveBeenCalledWith(schema.recentlyViewed);
            expect(inArrayMock).toHaveBeenCalledWith(
                schema.recentlyViewed.contentId,
                [11, 12]
            );
            expect(deleteWhere).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'inArray' })
            );
        });

        it('skips the delete entirely when the playlist has no content', async () => {
            const { db, deleteFn } = createDbMock([[]]);

            await expect(
                clearPlaylistRecentItems(db, 'playlist-empty')
            ).resolves.toEqual({ success: true });

            expect(deleteFn).not.toHaveBeenCalled();
        });

        it('removes a single entry scoped by content and playlist', async () => {
            const { db, deleteFn, deleteWhere } = createDbMock();

            await expect(
                removeRecentItem(db, 42, 'playlist-1')
            ).resolves.toEqual({ success: true });

            expect(deleteFn).toHaveBeenCalledWith(schema.recentlyViewed);
            expect(deleteWhere.mock.calls[0][0].conditions).toHaveLength(2);
            expect(eqMock).toHaveBeenCalledWith(
                schema.recentlyViewed.contentId,
                42
            );
            expect(eqMock).toHaveBeenCalledWith(
                schema.recentlyViewed.playlistId,
                'playlist-1'
            );
        });
    });

    describe('removeRecentItemsBatch', () => {
        it('returns a zero count without touching the database for empty input', async () => {
            const { db, deleteFn, transaction } = createDbMock();

            await expect(removeRecentItemsBatch(db, [])).resolves.toEqual({
                success: true,
                count: 0,
            });

            expect(deleteFn).not.toHaveBeenCalled();
            expect(transaction).not.toHaveBeenCalled();
        });

        it('executes one prepared placeholder delete per item inside a transaction', async () => {
            const { db, deleteExecute, deletePrepare, transaction } =
                createDbMock();

            await expect(
                removeRecentItemsBatch(db, [
                    { contentId: 1, playlistId: 'playlist-1' },
                    { contentId: 2, playlistId: 'playlist-2' },
                ])
            ).resolves.toEqual({ success: true, count: 2 });

            expect(deletePrepare).toHaveBeenCalledTimes(1);
            expect(sqlMock.placeholder).toHaveBeenCalledWith('contentId');
            expect(sqlMock.placeholder).toHaveBeenCalledWith('playlistId');
            expect(transaction).toHaveBeenCalledTimes(1);
            expect(deleteExecute).toHaveBeenNthCalledWith(1, {
                contentId: 1,
                playlistId: 'playlist-1',
            });
            expect(deleteExecute).toHaveBeenNthCalledWith(2, {
                contentId: 2,
                playlistId: 'playlist-2',
            });
        });
    });
});
