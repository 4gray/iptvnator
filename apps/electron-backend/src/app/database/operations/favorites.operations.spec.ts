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

import type { AppDatabase } from '../database.types';
import { getGlobalFavorites } from './favorites.operations';

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
});
