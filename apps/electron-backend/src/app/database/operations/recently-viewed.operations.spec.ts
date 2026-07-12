import {
    createDbMock,
    mockDrizzle,
    mockDrizzleOrmModule,
    resetDrizzleMocks,
} from './operations.test-helpers';

jest.mock('drizzle-orm', () => mockDrizzleOrmModule());

jest.mock('./content-backdrop.operations', () => ({
    persistContentBackdropIfMissing: jest.fn().mockResolvedValue(undefined),
}));

import * as schema from '@iptvnator/shared/database/schema';
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

describe('recently-viewed.operations', () => {
    beforeEach(() => {
        resetDrizzleMocks();
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

            expect(mockDrizzle.desc).toHaveBeenCalledWith(
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

            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.recentlyViewed.playlistId,
                'playlist-1'
            );
            expect(mockDrizzle.desc).toHaveBeenCalledWith(
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
            expect(mockDrizzle.sql).toHaveBeenCalledWith(['CURRENT_TIMESTAMP']);
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.recentlyViewed.contentId,
                42
            );
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
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

            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.categories.playlistId,
                'playlist-1'
            );
            expect(deleteFn).toHaveBeenCalledWith(schema.recentlyViewed);
            expect(mockDrizzle.inArray).toHaveBeenCalledWith(
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
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.recentlyViewed.contentId,
                42
            );
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
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

        it('runs one prepared placeholder delete per item inside a transaction', async () => {
            const { db, deleteRun, deleteExecute, deletePrepare, transaction } =
                createDbMock();

            await expect(
                removeRecentItemsBatch(db, [
                    { contentId: 1, playlistId: 'playlist-1' },
                    { contentId: 2, playlistId: 'playlist-2' },
                ])
            ).resolves.toEqual({ success: true, count: 2 });

            expect(deletePrepare).toHaveBeenCalledTimes(1);
            expect(mockDrizzle.sql.placeholder).toHaveBeenCalledWith('contentId');
            expect(mockDrizzle.sql.placeholder).toHaveBeenCalledWith('playlistId');
            expect(transaction).toHaveBeenCalledTimes(1);
            // Regression (issue #1137): the prepared delete must be dispatched
            // with synchronous `.run()`. `.execute()` defers to a promise that
            // never settles inside the synchronous transaction callback, so the
            // batch delete would silently no-op.
            expect(deleteExecute).not.toHaveBeenCalled();
            expect(deleteRun).toHaveBeenNthCalledWith(1, {
                contentId: 1,
                playlistId: 'playlist-1',
            });
            expect(deleteRun).toHaveBeenNthCalledWith(2, {
                contentId: 2,
                playlistId: 'playlist-2',
            });
        });
    });
});
