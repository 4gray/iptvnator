const andMock = jest.fn((...conditions: unknown[]) => ({
    kind: 'and',
    conditions,
}));
const eqMock = jest.fn((left: unknown, right: unknown) => ({
    kind: 'eq',
    left,
    right,
}));

jest.mock('drizzle-orm', () => ({
    and: (...conditions: unknown[]) => andMock(...conditions),
    asc: jest.fn(),
    desc: jest.fn(),
    eq: (left: unknown, right: unknown) => eqMock(left, right),
    inArray: jest.fn(),
    or: jest.fn(),
    sql: jest.fn(),
}));

import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import { getContentByXtreamId, saveContent } from './content.operations';

function createDbMock(result: unknown[] = []) {
    const limit = jest.fn().mockResolvedValue(result);
    const where = jest.fn().mockReturnValue({ limit });
    const innerJoin = jest.fn().mockReturnValue({ where });
    const from = jest.fn().mockReturnValue({ innerJoin });
    const select = jest.fn().mockReturnValue({ from });

    return {
        db: {
            select,
        } as unknown as AppDatabase,
        innerJoin,
        limit,
        select,
        where,
    };
}

describe('content.operations', () => {
    beforeEach(() => {
        andMock.mockClear();
        eqMock.mockClear();
    });

    it('adds the content type filter when resolving by xtream ID', async () => {
        const { db, where } = createDbMock([
            {
                title: 'Krypton',
                type: 'series',
                xtream_id: 290,
            },
        ]);

        const result = await getContentByXtreamId(
            db,
            290,
            'playlist-1',
            'series'
        );

        expect(eqMock).toHaveBeenCalledWith(schema.content.xtreamId, 290);
        expect(eqMock).toHaveBeenCalledWith(
            schema.categories.playlistId,
            'playlist-1'
        );
        expect(eqMock).toHaveBeenCalledWith(schema.content.type, 'series');
        expect(where.mock.calls[0][0].conditions).toHaveLength(3);
        expect(result).toEqual(
            expect.objectContaining({
                title: 'Krypton',
                type: 'series',
                xtream_id: 290,
            })
        );
    });

    it('keeps the legacy lookup path when no content type is provided', async () => {
        const { db, where } = createDbMock();

        await getContentByXtreamId(db, 290, 'playlist-1');

        expect(eqMock).toHaveBeenCalledWith(schema.content.xtreamId, 290);
        expect(eqMock).toHaveBeenCalledWith(
            schema.categories.playlistId,
            'playlist-1'
        );
        expect(eqMock).not.toHaveBeenCalledWith(schema.content.type, 'series');
        expect(where.mock.calls[0][0].conditions).toHaveLength(2);
    });

    it('uses a synchronous better-sqlite transaction callback when saving content', async () => {
        const existingContentWhere = jest
            .fn()
            .mockResolvedValue([{ count: 0 }]);
        const existingContentInnerJoin = jest
            .fn()
            .mockReturnValue({ where: existingContentWhere });
        const existingContentFrom = jest
            .fn()
            .mockReturnValue({ innerJoin: existingContentInnerJoin });

        const categoriesWhere = jest.fn().mockResolvedValue([
            {
                id: 42,
                xtreamId: 201,
            },
        ]);
        const categoriesFrom = jest
            .fn()
            .mockReturnValue({ where: categoriesWhere });

        const select = jest
            .fn()
            .mockReturnValueOnce({ from: existingContentFrom })
            .mockReturnValueOnce({ from: categoriesFrom });

        const run = jest.fn();
        const onConflictDoNothing = jest.fn().mockReturnValue({ run });
        const values = jest.fn().mockReturnValue({ onConflictDoNothing });
        const insert = jest.fn().mockReturnValue({ values });
        const transactionResults: unknown[] = [];
        const transaction = jest.fn((callback: (tx: unknown) => unknown) => {
            const result = callback({ insert });
            transactionResults.push(result);

            if (
                typeof result === 'object' &&
                result !== null &&
                'then' in result
            ) {
                throw new Error('Transaction function cannot return a promise');
            }

            return result;
        });
        const db = {
            select,
            transaction,
        } as unknown as AppDatabase;

        await expect(
            saveContent(
                db,
                'playlist-1',
                [
                    {
                        category_id: '201',
                        name: 'News Live',
                        stream_id: '100',
                    },
                ],
                'live'
            )
        ).resolves.toEqual({ success: true, count: 1 });

        expect(transactionResults).toEqual([undefined]);
        expect(values).toHaveBeenCalledWith([
            expect.objectContaining({
                categoryId: 42,
                title: 'News Live',
                xtreamId: 100,
                type: 'live',
            }),
        ]);
        expect(run).toHaveBeenCalled();
    });

    it('does not persist far-future provider timestamps as valid recently-added dates', async () => {
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(Date.parse('2026-05-19T00:00:00.000Z'));
        const existingContentWhere = jest
            .fn()
            .mockResolvedValue([{ count: 0 }]);
        const existingContentInnerJoin = jest
            .fn()
            .mockReturnValue({ where: existingContentWhere });
        const existingContentFrom = jest
            .fn()
            .mockReturnValue({ innerJoin: existingContentInnerJoin });

        const categoriesWhere = jest.fn().mockResolvedValue([
            {
                id: 42,
                xtreamId: 201,
            },
        ]);
        const categoriesFrom = jest
            .fn()
            .mockReturnValue({ where: categoriesWhere });

        const select = jest
            .fn()
            .mockReturnValueOnce({ from: existingContentFrom })
            .mockReturnValueOnce({ from: categoriesFrom });

        const run = jest.fn();
        const onConflictDoNothing = jest.fn().mockReturnValue({ run });
        const values = jest.fn().mockReturnValue({ onConflictDoNothing });
        const insert = jest.fn().mockReturnValue({ values });
        const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
            callback({ insert })
        );
        const db = {
            select,
            transaction,
        } as unknown as AppDatabase;

        try {
            await saveContent(
                db,
                'playlist-1',
                [
                    {
                        added: '1893456000',
                        category_id: '201',
                        name: 'Future Movie',
                        stream_id: '100',
                    },
                    {
                        added: '1779062400',
                        category_id: '201',
                        name: 'Fresh Movie',
                        stream_id: '101',
                    },
                    {
                        category_id: '201',
                        last_modified: '1778976000',
                        name: 'Modified Movie',
                        stream_id: '102',
                    },
                ],
                'movie'
            );

            expect(values).toHaveBeenCalledWith([
                expect.objectContaining({
                    title: 'Future Movie',
                    added: '',
                }),
                expect.objectContaining({
                    title: 'Fresh Movie',
                    added: '1779062400',
                }),
                expect.objectContaining({
                    title: 'Modified Movie',
                    added: '1778976000',
                }),
            ]);
        } finally {
            dateNowSpy.mockRestore();
        }
    });
});
