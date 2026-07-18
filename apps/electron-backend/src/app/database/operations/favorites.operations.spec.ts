const eqMock = jest.fn((left: unknown, right: unknown) => ({
    kind: 'eq',
    left,
    right,
}));
const whereMock = jest.fn();

jest.mock('drizzle-orm', () => ({
    and: jest.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
    asc: jest.fn((value: unknown) => ({ kind: 'asc', value })),
    desc: jest.fn((value: unknown) => ({ kind: 'desc', value })),
    eq: (left: unknown, right: unknown) => eqMock(left, right),
    inArray: jest.fn(),
    sql: jest.fn(),
}));

import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    getAllGlobalFavorites,
    getFavorites,
    getGlobalFavorites,
} from './favorites.operations';

function createGlobalFavoritesDbMock(rows: unknown[]) {
    const query = {
        from: jest.fn(),
        innerJoin: jest.fn(),
        limit: jest.fn(),
        orderBy: jest.fn(),
        then: jest.fn((resolve, reject) =>
            Promise.resolve(rows).then(resolve, reject)
        ),
        where: whereMock,
    };
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.limit.mockResolvedValue(rows);
    const select = jest.fn().mockReturnValue(query);

    return {
        db: {
            select,
        } as unknown as AppDatabase,
        query,
        select,
    };
}

describe('favorites.operations', () => {
    beforeEach(() => {
        eqMock.mockClear();
        whereMock.mockClear();
    });

    it('filters live global favorites after scanning the small favorites set', async () => {
        const { db, query } = createGlobalFavoritesDbMock([
            {
                id: 1,
                title: 'Saved Movie',
                type: 'movie',
            },
            {
                id: 2,
                title: 'Saved Live Channel',
                type: 'live',
            },
        ]);

        const result = await getGlobalFavorites(db);

        expect(whereMock).not.toHaveBeenCalled();
        expect(query.limit).not.toHaveBeenCalled();
        expect(result).toEqual([
            expect.objectContaining({
                id: 2,
                title: 'Saved Live Channel',
                type: 'live',
            }),
        ]);
    });

    // Regression for issue #1138: archive metadata must survive every
    // favorites projection so catch-up stays available outside Live TV.
    it('selects archive metadata for playlist favorites', async () => {
        const { db, select } = createGlobalFavoritesDbMock([]);

        await getFavorites(db, 'playlist-1');

        expect(select).toHaveBeenCalledWith(
            expect.objectContaining({
                tv_archive: schema.content.tvArchive,
                tv_archive_duration: schema.content.tvArchiveDuration,
            })
        );
    });

    it('selects archive metadata for global favorites', async () => {
        const { db, select } = createGlobalFavoritesDbMock([]);

        await getGlobalFavorites(db);
        await getAllGlobalFavorites(db);

        expect(select).toHaveBeenCalledTimes(2);
        for (const [projection] of select.mock.calls) {
            expect(projection).toEqual(
                expect.objectContaining({
                    tv_archive: schema.content.tvArchive,
                    tv_archive_duration: schema.content.tvArchiveDuration,
                })
            );
        }
    });
});
