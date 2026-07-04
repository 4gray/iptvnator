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
const sqlMock = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
}));

jest.mock('drizzle-orm', () => ({
    and: (...conditions: unknown[]) => andMock(...conditions),
    desc: (value: unknown) => descMock(value),
    eq: (left: unknown, right: unknown) => eqMock(left, right),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
        sqlMock(strings, ...values),
}));

import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    clearAllPlaybackPositions,
    clearPlaybackPosition,
    getAllPlaybackPositions,
    getPlaybackPosition,
    getRecentPlaybackPositions,
    getSeriesPlaybackPositions,
    savePlaybackPosition,
} from './playback-position.operations';

type QueryMock = {
    from: jest.Mock;
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
            where: jest.fn(),
            orderBy: jest.fn(),
            limit: jest.fn().mockResolvedValue(rows),
            then: (resolve, reject) =>
                Promise.resolve(rows).then(resolve, reject),
        };
        query.from.mockReturnValue(query);
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

    const deleteWhere = jest.fn().mockResolvedValue(undefined);
    const deleteFn = jest.fn().mockReturnValue({ where: deleteWhere });

    return {
        db: {
            select,
            insert,
            update,
            delete: deleteFn,
        } as unknown as AppDatabase,
        deleteFn,
        deleteWhere,
        insert,
        insertValues,
        queries,
        select,
        update,
        updateSet,
        updateWhere,
    };
}

describe('playback-position.operations', () => {
    beforeEach(() => {
        andMock.mockClear();
        descMock.mockClear();
        eqMock.mockClear();
        sqlMock.mockClear();
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
            expect(eqMock).toHaveBeenCalledWith(
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

            expect(sqlMock).toHaveBeenCalledWith(['CURRENT_TIMESTAMP']);
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
            expect(eqMock).toHaveBeenCalledWith(
                schema.playbackPositions.playlistId,
                'playlist-1'
            );
            expect(eqMock).toHaveBeenCalledWith(
                schema.playbackPositions.contentXtreamId,
                500
            );
            expect(eqMock).toHaveBeenCalledWith(
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

            expect(eqMock).toHaveBeenCalledWith(
                schema.playbackPositions.seriesXtreamId,
                42
            );
            expect(eqMock).toHaveBeenCalledWith(
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

            expect(descMock).toHaveBeenCalledWith(
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

            expect(eqMock).toHaveBeenCalledWith(
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
            expect(eqMock).toHaveBeenCalledWith(
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
            expect(eqMock).toHaveBeenCalledWith(
                schema.playbackPositions.contentXtreamId,
                500
            );
            expect(eqMock).toHaveBeenCalledWith(
                schema.playbackPositions.contentType,
                'vod'
            );
        });
    });
});
