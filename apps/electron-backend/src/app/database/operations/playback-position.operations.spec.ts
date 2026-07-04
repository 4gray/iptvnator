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
    getAllPlaybackPositions,
    getPlaybackPosition,
    getRecentPlaybackPositions,
    getSeriesPlaybackPositions,
    savePlaybackPosition,
} from './playback-position.operations';

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
});
