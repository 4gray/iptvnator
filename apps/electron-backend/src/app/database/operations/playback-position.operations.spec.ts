import {
    createDbMock,
    mockDrizzle,
    mockDrizzleOrmModule,
    resetDrizzleMocks,
} from './operations.test-helpers';

jest.mock('drizzle-orm', () => mockDrizzleOrmModule());

import * as schema from '@iptvnator/shared/database/schema';
import {
    clearAllPlaybackPositions,
    clearPlaybackPosition,
    clearPlaybackPositionsBatch,
    getAllPlaybackPositions,
    getPlaybackPosition,
    getRecentPlaybackPositions,
    getSeriesPlaybackPositions,
    savePlaybackPosition,
    savePlaybackPositionsBatch,
} from './playback-position.operations';

/**
 * Batch saves upsert inside a synchronous transaction, so the insert chain
 * has to end in a synchronous `.run()` rather than resolving — exactly as
 * the better-sqlite3 driver requires (issue #1137). The wrapper exposes
 * both dispatch methods so the specs can assert the correct one is used.
 */
function createBatchUpsertDbMock(selectResultsByCall: unknown[][] = []) {
    const mock = createDbMock(selectResultsByCall);
    const insertExecute = jest.fn().mockResolvedValue(undefined);
    const onConflictDoUpdate = jest
        .fn()
        .mockReturnValue({ run: mock.insertRun, execute: insertExecute });
    mock.insertValues.mockReturnValue({ onConflictDoUpdate });
    return { ...mock, insertExecute, onConflictDoUpdate };
}

describe('playback-position.operations', () => {
    beforeEach(() => {
        resetDrizzleMocks();
    });

    describe('savePlaybackPosition', () => {
        it('creates a stalker placeholder playlist before inserting a new position', async () => {
            const { db, insert, insertValues } = createDbMock([[], []]);

            const result = await savePlaybackPosition(db, 'playlist-1', {
                contentXtreamId: 500,
                contentType: 'vod',
                positionSeconds: 120,
                durationSeconds: 3600,
            });

            expect(result).toEqual({ success: true });
            expect(insert).toHaveBeenNthCalledWith(1, schema.playlists);
            expect(insert).toHaveBeenNthCalledWith(
                2,
                schema.playbackPositions
            );
            expect(insertValues).toHaveBeenNthCalledWith(1, {
                id: 'playlist-1',
                name: 'Imported Playlist',
                type: 'stalker',
            });
            expect(insertValues).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    playlistId: 'playlist-1',
                    contentXtreamId: 500,
                    contentType: 'vod',
                    positionSeconds: 120,
                    durationSeconds: 3600,
                })
            );
        });

        it('honors the provided playlist type when creating the missing playlist', async () => {
            const { db, insertValues } = createDbMock([[], []]);

            await savePlaybackPosition(db, 'playlist-xt', {
                contentXtreamId: 7,
                contentType: 'vod',
                positionSeconds: 10,
                playlistType: 'xtream',
            });

            expect(insertValues).toHaveBeenNthCalledWith(1, {
                id: 'playlist-xt',
                name: 'Imported Playlist',
                type: 'xtream',
            });
        });

        it('does not recreate a playlist that already exists', async () => {
            const { db, insert } = createDbMock([[{ id: 'playlist-1' }], []]);

            await savePlaybackPosition(db, 'playlist-1', {
                contentXtreamId: 500,
                contentType: 'vod',
                positionSeconds: 120,
            });

            expect(insert).toHaveBeenCalledTimes(1);
            expect(insert).toHaveBeenCalledWith(schema.playbackPositions);
        });

        it('updates the existing row instead of inserting a duplicate position', async () => {
            const { db, insert, update, updateSet } = createDbMock([
                [{ id: 'playlist-1' }],
                [{ id: 33, positionSeconds: 15 }],
            ]);

            const result = await savePlaybackPosition(db, 'playlist-1', {
                contentXtreamId: 500,
                contentType: 'episode',
                seriesXtreamId: 42,
                seasonNumber: 2,
                episodeNumber: 5,
                positionSeconds: 480,
            });

            expect(result).toEqual({ success: true });
            expect(insert).not.toHaveBeenCalled();
            expect(update).toHaveBeenCalledWith(schema.playbackPositions);
            expect(updateSet).toHaveBeenCalledWith(
                expect.objectContaining({
                    seriesXtreamId: 42,
                    seasonNumber: 2,
                    episodeNumber: 5,
                    positionSeconds: 480,
                })
            );
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.id,
                33
            );
        });

        it('stamps updatedAt with CURRENT_TIMESTAMP on every save', async () => {
            const { db, insertValues } = createDbMock([[], []]);

            await savePlaybackPosition(db, 'playlist-1', {
                contentXtreamId: 500,
                contentType: 'vod',
                positionSeconds: 120,
            });

            expect(mockDrizzle.sql).toHaveBeenCalledWith(['CURRENT_TIMESTAMP']);
            expect(insertValues).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    updatedAt: expect.objectContaining({ kind: 'sql' }),
                })
            );
        });
    });

    describe('savePlaybackPositionsBatch', () => {
        it('returns a zero count without touching the database for empty input', async () => {
            const { db, select, insert, transaction } = createDbMock();

            await expect(
                savePlaybackPositionsBatch(db, 'playlist-1', [])
            ).resolves.toEqual({ success: true, count: 0 });

            expect(select).not.toHaveBeenCalled();
            expect(insert).not.toHaveBeenCalled();
            expect(transaction).not.toHaveBeenCalled();
        });

        it('upserts every item inside one transaction with the composite conflict target', async () => {
            const {
                db,
                select,
                insert,
                insertValues,
                onConflictDoUpdate,
                insertRun,
                insertExecute,
                transaction,
            } = createBatchUpsertDbMock([[{ id: 'playlist-1' }]]);

            const result = await savePlaybackPositionsBatch(db, 'playlist-1', [
                {
                    contentXtreamId: 500,
                    contentType: 'vod',
                    positionSeconds: 120,
                    durationSeconds: 3600,
                },
                {
                    contentXtreamId: 42,
                    contentType: 'episode',
                    seriesXtreamId: 7,
                    seasonNumber: 2,
                    episodeNumber: 5,
                    positionSeconds: 480,
                },
            ]);

            expect(result).toEqual({ success: true, count: 2 });
            // The playlist existence check runs exactly once for the whole
            // batch, and it must complete before the synchronous transaction
            // callback starts.
            expect(select).toHaveBeenCalledTimes(1);
            expect(select.mock.invocationCallOrder[0]).toBeLessThan(
                transaction.mock.invocationCallOrder[0]
            );
            expect(transaction).toHaveBeenCalledTimes(1);
            expect(insert).toHaveBeenCalledTimes(2);
            expect(insert).toHaveBeenCalledWith(schema.playbackPositions);
            expect(insertValues).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    playlistId: 'playlist-1',
                    contentXtreamId: 500,
                    contentType: 'vod',
                    positionSeconds: 120,
                    durationSeconds: 3600,
                    updatedAt: expect.objectContaining({ kind: 'sql' }),
                })
            );
            expect(insertValues).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    playlistId: 'playlist-1',
                    contentXtreamId: 42,
                    contentType: 'episode',
                    seriesXtreamId: 7,
                    seasonNumber: 2,
                    episodeNumber: 5,
                    positionSeconds: 480,
                })
            );
            expect(onConflictDoUpdate).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    target: [
                        schema.playbackPositions.contentXtreamId,
                        schema.playbackPositions.playlistId,
                        schema.playbackPositions.contentType,
                    ],
                    set: expect.objectContaining({
                        positionSeconds: 120,
                        durationSeconds: 3600,
                        updatedAt: expect.objectContaining({ kind: 'sql' }),
                    }),
                })
            );
            expect(onConflictDoUpdate).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    set: expect.objectContaining({
                        seriesXtreamId: 7,
                        seasonNumber: 2,
                        episodeNumber: 5,
                        positionSeconds: 480,
                    }),
                })
            );
            // Regression (issue #1137): the upsert must be dispatched with
            // synchronous `.run()`. `.execute()` defers to a promise that
            // never settles inside the synchronous transaction callback, so
            // the batch write would silently no-op.
            expect(insertExecute).not.toHaveBeenCalled();
            expect(insertRun).toHaveBeenCalledTimes(2);
        });

        it('creates the missing playlist once, honoring the first item playlist type', async () => {
            const { db, insert, insertValues } = createBatchUpsertDbMock([[]]);

            await savePlaybackPositionsBatch(db, 'playlist-xt', [
                {
                    contentXtreamId: 1,
                    contentType: 'vod',
                    positionSeconds: 10,
                    playlistType: 'xtream',
                },
                {
                    contentXtreamId: 2,
                    contentType: 'vod',
                    positionSeconds: 20,
                },
            ]);

            // One playlist insert despite two items, then one position
            // upsert per item.
            expect(insert).toHaveBeenCalledTimes(3);
            expect(insert).toHaveBeenNthCalledWith(1, schema.playlists);
            expect(insertValues).toHaveBeenNthCalledWith(1, {
                id: 'playlist-xt',
                name: 'Imported Playlist',
                type: 'xtream',
            });
            expect(insert).toHaveBeenNthCalledWith(
                2,
                schema.playbackPositions
            );
            expect(insert).toHaveBeenNthCalledWith(
                3,
                schema.playbackPositions
            );
        });
    });

    describe('getPlaybackPosition', () => {
        it('returns the matching row scoped by playlist, content, and type', async () => {
            const row = {
                id: 1,
                playlistId: 'playlist-1',
                contentXtreamId: 500,
                positionSeconds: 99,
            };
            const { db } = createDbMock([[row]]);

            const result = await getPlaybackPosition(
                db,
                'playlist-1',
                500,
                'vod'
            );

            expect(result).toEqual(row);
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.playlistId,
                'playlist-1'
            );
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.contentXtreamId,
                500
            );
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.contentType,
                'vod'
            );
        });

        it('returns null when no position is stored', async () => {
            const { db } = createDbMock([[]]);

            await expect(
                getPlaybackPosition(db, 'playlist-1', 999, 'episode')
            ).resolves.toBeNull();
        });
    });

    describe('series and playlist queries', () => {
        it('restricts series positions to episode rows for the series', async () => {
            const rows = [{ id: 1 }, { id: 2 }];
            const { db, queries } = createDbMock([rows]);

            await expect(
                getSeriesPlaybackPositions(db, 'playlist-1', 42)
            ).resolves.toEqual(rows);

            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.seriesXtreamId,
                42
            );
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.contentType,
                'episode'
            );
            expect(queries[0].limit).not.toHaveBeenCalled();
        });

        it('returns recent positions newest-first with the default limit of 20', async () => {
            const rows = [{ id: 3 }];
            const { db, queries } = createDbMock([rows]);

            await expect(
                getRecentPlaybackPositions(db, 'playlist-1')
            ).resolves.toEqual(rows);

            expect(mockDrizzle.desc).toHaveBeenCalledWith(
                schema.playbackPositions.updatedAt
            );
            expect(queries[0].limit).toHaveBeenCalledWith(20);
        });

        it('passes a custom limit through to the recent positions query', async () => {
            const { db, queries } = createDbMock([[]]);

            await getRecentPlaybackPositions(db, 'playlist-1', 5);

            expect(queries[0].limit).toHaveBeenCalledWith(5);
        });

        it('returns all playlist positions without ordering or limits', async () => {
            const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
            const { db, queries } = createDbMock([rows]);

            await expect(
                getAllPlaybackPositions(db, 'playlist-1')
            ).resolves.toEqual(rows);

            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.playlistId,
                'playlist-1'
            );
            expect(queries[0].orderBy).not.toHaveBeenCalled();
            expect(queries[0].limit).not.toHaveBeenCalled();
        });
    });

    describe('clearing positions', () => {
        it('clears every position of a playlist', async () => {
            const { db, deleteFn, deleteWhere } = createDbMock();

            await expect(
                clearAllPlaybackPositions(db, 'playlist-1')
            ).resolves.toEqual({ success: true });

            expect(deleteFn).toHaveBeenCalledWith(schema.playbackPositions);
            expect(deleteWhere).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'eq' })
            );
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.playlistId,
                'playlist-1'
            );
        });

        it('clears a single content position scoped by playlist, content, and type', async () => {
            const { db, deleteFn, deleteWhere } = createDbMock();

            await expect(
                clearPlaybackPosition(db, 'playlist-1', 500, 'vod')
            ).resolves.toEqual({ success: true });

            expect(deleteFn).toHaveBeenCalledWith(schema.playbackPositions);
            expect(deleteWhere.mock.calls[0][0].conditions).toHaveLength(3);
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.contentXtreamId,
                500
            );
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.contentType,
                'vod'
            );
        });
    });

    describe('clearPlaybackPositionsBatch', () => {
        it('returns a zero count without touching the database for empty input', async () => {
            const { db, deleteFn, transaction } = createDbMock();

            await expect(
                clearPlaybackPositionsBatch(db, 'playlist-1', [])
            ).resolves.toEqual({ success: true, count: 0 });

            expect(deleteFn).not.toHaveBeenCalled();
            expect(transaction).not.toHaveBeenCalled();
        });

        it('runs one prepared placeholder delete per item inside a transaction', async () => {
            const {
                db,
                deleteFn,
                deletePrepare,
                deleteRun,
                deleteExecute,
                transaction,
            } = createDbMock();

            await expect(
                clearPlaybackPositionsBatch(db, 'playlist-1', [
                    { contentXtreamId: 500, contentType: 'vod' },
                    { contentXtreamId: 42, contentType: 'episode' },
                ])
            ).resolves.toEqual({ success: true, count: 2 });

            expect(deleteFn).toHaveBeenCalledWith(schema.playbackPositions);
            expect(deletePrepare).toHaveBeenCalledTimes(1);
            // The playlist id is bound directly; content id and type are
            // per-item placeholders.
            expect(mockDrizzle.eq).toHaveBeenCalledWith(
                schema.playbackPositions.playlistId,
                'playlist-1'
            );
            expect(mockDrizzle.sql.placeholder).toHaveBeenCalledWith(
                'contentXtreamId'
            );
            expect(mockDrizzle.sql.placeholder).toHaveBeenCalledWith(
                'contentType'
            );
            expect(transaction).toHaveBeenCalledTimes(1);
            // Regression (issue #1137): the prepared delete must be
            // dispatched with synchronous `.run()`. `.execute()` defers to a
            // promise that never settles inside the synchronous transaction
            // callback, so the batch delete would silently no-op.
            expect(deleteExecute).not.toHaveBeenCalled();
            expect(deleteRun).toHaveBeenNthCalledWith(1, {
                contentXtreamId: 500,
                contentType: 'vod',
            });
            expect(deleteRun).toHaveBeenNthCalledWith(2, {
                contentXtreamId: 42,
                contentType: 'episode',
            });
        });
    });
});
