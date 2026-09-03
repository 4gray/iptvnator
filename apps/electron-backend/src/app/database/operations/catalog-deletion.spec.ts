import { mockDrizzle, mockDrizzleOrmModule } from './operations.test-helpers';

jest.mock('drizzle-orm', () => mockDrizzleOrmModule());

import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    countContentRowsByCategory,
    deleteCategoriesWhere,
    deleteContentByCategoryGroups,
    groupCategoriesByRowBudget,
    requireScopedFilter,
    resolveContentRowsPerTransaction,
    sumCategoryRowCounts,
} from './catalog-deletion';

function createDeleteDb(changesForGroup: (group: number[]) => number) {
    const groups: number[][] = [];
    const tables: unknown[] = [];
    const deleteRows = jest.fn((table: unknown) => {
        tables.push(table);
        return {
            where: jest.fn((condition: { values: number[] }) => {
                groups.push(condition.values);
                return {
                    run: jest.fn(() => ({
                        changes: changesForGroup(condition.values),
                    })),
                };
            }),
        };
    });
    const transaction = jest.fn((execute: (tx: unknown) => unknown) =>
        execute({ delete: deleteRows })
    );

    return {
        db: { transaction } as unknown as AppDatabase,
        groups,
        tables,
        transaction,
    };
}

describe('groupCategoriesByRowBudget', () => {
    it('packs consecutive categories until the next one would exceed the budget', () => {
        expect(
            groupCategoriesByRowBudget(
                [
                    { categoryId: 1, rowCount: 3000 },
                    { categoryId: 2, rowCount: 1500 },
                    { categoryId: 3, rowCount: 600 },
                    { categoryId: 4, rowCount: 400 },
                ],
                5000
            )
        ).toEqual([[1, 2], [3, 4]]);
    });

    it('gives a category larger than the budget a group of its own', () => {
        expect(
            groupCategoriesByRowBudget(
                [
                    { categoryId: 1, rowCount: 10 },
                    { categoryId: 2, rowCount: 9000 },
                    { categoryId: 3, rowCount: 10 },
                ],
                5000
            )
        ).toEqual([[1], [2], [3]]);
    });

    it('skips categories without content and returns nothing for none', () => {
        expect(
            groupCategoriesByRowBudget(
                [
                    { categoryId: 1, rowCount: 0 },
                    { categoryId: 2, rowCount: 5 },
                ],
                5000
            )
        ).toEqual([[2]]);
        expect(groupCategoriesByRowBudget([], 5000)).toEqual([]);
    });
});

describe('resolveContentRowsPerTransaction', () => {
    it('defaults to 5,000 rows unless the test knob names a positive integer', () => {
        expect(resolveContentRowsPerTransaction(undefined)).toBe(5000);
        expect(resolveContentRowsPerTransaction('')).toBe(5000);
        expect(resolveContentRowsPerTransaction('0')).toBe(5000);
        expect(resolveContentRowsPerTransaction('-100')).toBe(5000);
        expect(resolveContentRowsPerTransaction('abc')).toBe(5000);
        expect(resolveContentRowsPerTransaction('100')).toBe(100);
    });
});

describe('requireScopedFilter', () => {
    it('refuses the unbounded filter drizzle returns for an empty and()', () => {
        expect(() => requireScopedFilter(undefined)).toThrow(
            'Refusing an unscoped catalog delete'
        );
    });

    it('passes a real filter through', () => {
        const filter = mockDrizzle.eq('a', 'b') as never;
        expect(requireScopedFilter(filter)).toBe(filter);
    });
});

describe('countContentRowsByCategory', () => {
    it('groups the joined count by category under the given filter', async () => {
        const rows = [{ categoryId: 7, rowCount: 3 }];
        const groupBy = jest.fn().mockResolvedValue(rows);
        const where = jest.fn(() => ({ groupBy }));
        const innerJoin = jest.fn(() => ({ where }));
        const from = jest.fn(() => ({ innerJoin }));
        const select = jest.fn(() => ({ from }));
        const filter = mockDrizzle.eq(
            schema.categories.playlistId,
            'playlist-1'
        ) as never;

        await expect(
            countContentRowsByCategory(
                { select } as unknown as AppDatabase,
                filter
            )
        ).resolves.toBe(rows);

        expect(from).toHaveBeenCalledWith(schema.content);
        expect(innerJoin).toHaveBeenCalledWith(
            schema.categories,
            expect.objectContaining({ kind: 'eq' })
        );
        expect(where).toHaveBeenCalledWith(filter);
        expect(groupBy).toHaveBeenCalledWith(schema.content.categoryId);
        expect(sumCategoryRowCounts(rows)).toBe(3);
    });
});

describe('deleteContentByCategoryGroups', () => {
    const counts = [
        { categoryId: 1, rowCount: 3000 },
        { categoryId: 2, rowCount: 3000 },
        { categoryId: 3, rowCount: 10 },
    ];
    const rowsIn = (group: number[]) =>
        group.reduce(
            (sum, id) =>
                sum + (counts.find((c) => c.categoryId === id)?.rowCount ?? 0),
            0
        );

    it('commits one budgeted category group per transaction with a checkpoint before and progress after', async () => {
        const timeline: string[] = [];
        const checkpoint = jest.fn(() => {
            timeline.push('checkpoint');
        });
        const onProgress = jest.fn((progress: { current?: number }) => {
            timeline.push(`progress:${progress.current}`);
        });
        const db = createDeleteDb(rowsIn);
        const runTransaction = db.transaction.getMockImplementation();
        db.transaction.mockImplementation((execute) => {
            timeline.push('transaction');
            return runTransaction?.(execute);
        });

        await expect(
            deleteContentByCategoryGroups(db.db, counts, {
                control: { checkpoint, onProgress },
                phase: 'deleting-content',
                rowsPerTransaction: 5000,
            })
        ).resolves.toBe(6010);

        expect(db.groups).toEqual([[1], [2, 3]]);
        expect(db.tables).toEqual([schema.content, schema.content]);
        expect(mockDrizzle.inArray).toHaveBeenCalledWith(
            schema.content.categoryId,
            [1]
        );
        expect(mockDrizzle.inArray).toHaveBeenCalledWith(
            schema.content.categoryId,
            [2, 3]
        );
        expect(onProgress.mock.calls.map(([value]) => value)).toEqual([
            {
                phase: 'deleting-content',
                current: 3000,
                total: 6010,
                increment: 3000,
            },
            {
                phase: 'deleting-content',
                current: 6010,
                total: 6010,
                increment: 3010,
            },
        ]);
        expect(timeline).toEqual([
            'checkpoint',
            'transaction',
            'progress:3000',
            'checkpoint',
            'checkpoint',
            'transaction',
            'progress:6010',
            'checkpoint',
        ]);
    });

    it('stops at the next checkpoint when cancelled, keeping the committed group', async () => {
        const db = createDeleteDb(rowsIn);
        const cancellation = new Error('cancelled');
        cancellation.name = 'AbortError';
        let checkpoints = 0;

        await expect(
            deleteContentByCategoryGroups(db.db, counts, {
                control: {
                    checkpoint: () => {
                        checkpoints += 1;
                        if (checkpoints === 2) {
                            throw cancellation;
                        }
                    },
                },
                phase: 'deleting-content',
                rowsPerTransaction: 5000,
            })
        ).rejects.toBe(cancellation);

        expect(db.transaction).toHaveBeenCalledTimes(1);
        expect(db.groups).toEqual([[1]]);
    });

    it('defaults to a 5,000-row budget per transaction', async () => {
        const budgetCounts = [
            { categoryId: 1, rowCount: 3000 },
            { categoryId: 2, rowCount: 2000 },
            { categoryId: 3, rowCount: 1 },
        ];
        const db = createDeleteDb((group) =>
            group.reduce(
                (sum, id) =>
                    sum +
                    (budgetCounts.find((c) => c.categoryId === id)?.rowCount ??
                        0),
                0
            )
        );

        await expect(
            deleteContentByCategoryGroups(db.db, budgetCounts, {
                phase: 'deleting-content',
            })
        ).resolves.toBe(5001);

        // 3000 + 2000 fill the budget exactly; the next row starts a group.
        expect(db.groups).toEqual([[1, 2], [3]]);
    });

    it('does nothing for categories without content', async () => {
        const db = createDeleteDb(rowsIn);
        const onProgress = jest.fn();

        await expect(
            deleteContentByCategoryGroups(db.db, [], {
                control: { onProgress },
                phase: 'deleting-content',
            })
        ).resolves.toBe(0);

        expect(db.transaction).not.toHaveBeenCalled();
        expect(onProgress).not.toHaveBeenCalled();
    });
});

describe('deleteCategoriesWhere', () => {
    it('deletes the filtered categories in one transaction and reports the count', async () => {
        const where = jest.fn(() => ({ run: () => ({ changes: 4 }) }));
        const deleteRows = jest.fn(() => ({ where }));
        const transaction = jest.fn((execute: (tx: unknown) => unknown) =>
            execute({ delete: deleteRows })
        );
        const filter = mockDrizzle.eq(
            schema.categories.playlistId,
            'playlist-1'
        ) as never;

        await expect(
            deleteCategoriesWhere(
                { transaction } as unknown as AppDatabase,
                filter
            )
        ).resolves.toBe(4);

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(deleteRows).toHaveBeenCalledWith(schema.categories);
        expect(where).toHaveBeenCalledWith(filter);
    });
});
