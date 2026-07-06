const eqMock = jest.fn((left: unknown, right: unknown) => ({
    kind: 'eq',
    left,
    right,
}));
const whereMock = jest.fn();
const placeholderMock = jest.fn((name: string) => ({
    kind: 'placeholder',
    name,
}));

jest.mock('drizzle-orm', () => ({
    and: jest.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
    asc: jest.fn((value: unknown) => ({ kind: 'asc', value })),
    desc: jest.fn((value: unknown) => ({ kind: 'desc', value })),
    eq: (left: unknown, right: unknown) => eqMock(left, right),
    inArray: jest.fn(),
    sql: Object.assign(
        jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
            kind: 'sql',
            strings: Array.from(strings ?? []),
            values,
        })),
        { placeholder: (name: string) => placeholderMock(name) }
    ),
}));

import type { AppDatabase } from '../database.types';
import { createDbMock } from './operations.test-helpers';
import {
    getGlobalFavorites,
    reorderGlobalFavorites,
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
        placeholderMock.mockClear();
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

    describe('reorderGlobalFavorites', () => {
        it('short-circuits without touching the db when there are no updates', async () => {
            const { db, update, transaction } = createDbMock();

            await expect(reorderGlobalFavorites(db, [])).resolves.toEqual({
                success: true,
            });

            expect(update).not.toHaveBeenCalled();
            expect(transaction).not.toHaveBeenCalled();
        });

        it('runs (not executes) the prepared position update per favorite inside a transaction', async () => {
            const { db, updateRun, updateExecute, updatePrepare, transaction } =
                createDbMock();

            await expect(
                reorderGlobalFavorites(db, [
                    { content_id: 30, position: 0 },
                    { content_id: 10, position: 1 },
                    { content_id: 20, position: 2 },
                ])
            ).resolves.toEqual({ success: true });

            expect(updatePrepare).toHaveBeenCalledTimes(1);
            expect(placeholderMock).toHaveBeenCalledWith('position');
            expect(placeholderMock).toHaveBeenCalledWith('contentId');
            expect(transaction).toHaveBeenCalledTimes(1);

            // Regression (issue #1137): the prepared UPDATE must be dispatched
            // with synchronous `.run()`. On the better-sqlite3 driver
            // `.execute()` defers the write to a promise that never settles
            // inside the synchronous transaction callback, so favorites
            // positions silently never persist and the custom order is lost.
            expect(updateExecute).not.toHaveBeenCalled();
            expect(updateRun).toHaveBeenNthCalledWith(1, {
                position: 0,
                contentId: 30,
            });
            expect(updateRun).toHaveBeenNthCalledWith(2, {
                position: 1,
                contentId: 10,
            });
            expect(updateRun).toHaveBeenNthCalledWith(3, {
                position: 2,
                contentId: 20,
            });
        });
    });
});
