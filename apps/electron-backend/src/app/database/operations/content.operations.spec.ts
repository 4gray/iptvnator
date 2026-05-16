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

import * as schema from 'database-schema';
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

function createSaveContentDbMock(
    categories: Array<{ id: number; xtreamId: number }>,
    existingContent: Array<Record<string, unknown>>
) {
    const categoriesWhere = jest.fn().mockResolvedValue(categories);
    const categoriesFrom = jest.fn().mockReturnValue({ where: categoriesWhere });
    const existingContentWhere = jest.fn().mockResolvedValue(existingContent);
    const existingContentInnerJoin = jest
        .fn()
        .mockReturnValue({ where: existingContentWhere });
    const existingContentFrom = jest
        .fn()
        .mockReturnValue({ innerJoin: existingContentInnerJoin });
    const select = jest
        .fn()
        .mockReturnValueOnce({ from: categoriesFrom })
        .mockReturnValueOnce({ from: existingContentFrom });

    const run = jest.fn();
    const onConflictDoNothing = jest.fn().mockReturnValue({ run });
    const values = jest.fn().mockReturnValue({ onConflictDoNothing });
    const insert = jest.fn().mockReturnValue({ values });
    const updateWhere = jest.fn().mockReturnValue({ run });
    const set = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set });
    const deleteWhere = jest.fn().mockReturnValue({ run });
    const deleteFn = jest.fn().mockReturnValue({ where: deleteWhere });
    const transactionResults: unknown[] = [];
    const transaction = jest.fn((callback: (tx: unknown) => unknown) => {
        const result = callback({
            delete: deleteFn,
            insert,
            update,
        });
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

    return {
        db: {
            select,
            transaction,
        } as unknown as AppDatabase,
        deleteFn,
        insert,
        run,
        set,
        transaction,
        transactionResults,
        update,
        values,
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
        const existingContentWhere = jest.fn().mockResolvedValue([]);
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
            .mockReturnValueOnce({ from: categoriesFrom })
            .mockReturnValueOnce({ from: existingContentFrom });

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
                        name: 'Cinema cittÃ ',
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
                title: 'Cinema città',
                xtreamId: 100,
                type: 'live',
            }),
        ]);
        expect(run).toHaveBeenCalled();
    });

    it('updates changed catalog fields without replacing cached media metadata', async () => {
        const { db, insert, set, update, values } = createSaveContentDbMock(
            [
                {
                    id: 42,
                    xtreamId: 201,
                },
            ],
            [
                {
                    id: 7,
                    categoryId: 42,
                    title: 'Old title',
                    rating: '',
                    added: '',
                    posterUrl: '',
                    epgChannelId: null,
                    tvArchive: 0,
                    tvArchiveDuration: 0,
                    directSource: null,
                    xtreamId: 100,
                    type: 'live',
                },
            ]
        );

        await expect(
            saveContent(
                db,
                'playlist-1',
                [
                    {
                        category_id: '201',
                        name: 'New title',
                        stream_id: '100',
                    },
                ],
                'live'
            )
        ).resolves.toEqual({ success: true, count: 1 });

        expect(insert).not.toHaveBeenCalled();
        expect(values).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalled();
        expect(set).toHaveBeenCalledWith(
            expect.not.objectContaining({
                mediaMetadata: expect.anything(),
                mediaMetadataUpdatedAt: expect.anything(),
            })
        );
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'New title',
            })
        );
    });

    it('keeps the existing cache when the provider returns an empty catalog', async () => {
        const { db, transaction } = createSaveContentDbMock(
            [
                {
                    id: 42,
                    xtreamId: 201,
                },
            ],
            [
                {
                    id: 7,
                    categoryId: 42,
                    title: 'Cached title',
                    rating: '',
                    added: '',
                    posterUrl: '',
                    epgChannelId: null,
                    tvArchive: 0,
                    tvArchiveDuration: 0,
                    directSource: null,
                    xtreamId: 100,
                    type: 'live',
                },
            ]
        );

        await expect(
            saveContent(db, 'playlist-1', [], 'live')
        ).resolves.toEqual({ success: true, count: 1 });

        expect(transaction).not.toHaveBeenCalled();
    });

    it('removes stale content and metadata jobs for catalog entries that disappeared', async () => {
        const { db, deleteFn } = createSaveContentDbMock(
            [
                {
                    id: 42,
                    xtreamId: 201,
                },
            ],
            [
                {
                    id: 7,
                    categoryId: 42,
                    title: 'Current movie',
                    rating: '',
                    added: '',
                    posterUrl: '',
                    epgChannelId: null,
                    tvArchive: null,
                    tvArchiveDuration: null,
                    directSource: null,
                    xtreamId: 100,
                    type: 'movie',
                },
                {
                    id: 8,
                    categoryId: 42,
                    title: 'Removed movie',
                    rating: '',
                    added: '',
                    posterUrl: '',
                    epgChannelId: null,
                    tvArchive: null,
                    tvArchiveDuration: null,
                    directSource: null,
                    xtreamId: 101,
                    type: 'movie',
                },
            ]
        );

        await expect(
            saveContent(
                db,
                'playlist-1',
                [
                    {
                        category_id: '201',
                        name: 'Current movie',
                        stream_id: '100',
                    },
                ],
                'movie'
            )
        ).resolves.toEqual({ success: true, count: 1 });

        expect(deleteFn).toHaveBeenCalledTimes(2);
    });
});
