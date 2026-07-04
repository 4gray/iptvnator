import type { AppDatabase } from '../database.types';

/**
 * Shared drizzle-orm query-builder mocks for the operations specs.
 * Jest keeps a separate module registry per test file, so every spec gets
 * its own mock instances. `jest.mock()` calls cannot live here (Jest hoists
 * them per file), so each spec registers the module mock itself:
 *
 *     jest.mock('drizzle-orm', () => mockDrizzleOrmModule());
 *
 * The `mock` prefix on the exports is required so the hoisted factory is
 * allowed to reference them.
 */
export const mockDrizzle = {
    and: jest.fn((...conditions: unknown[]) => ({
        kind: 'and',
        conditions,
    })),
    desc: jest.fn((value: unknown) => ({ kind: 'desc', value })),
    eq: jest.fn((left: unknown, right: unknown) => ({
        kind: 'eq',
        left,
        right,
    })),
    inArray: jest.fn((left: unknown, values: unknown[]) => ({
        kind: 'inArray',
        left,
        values,
    })),
    sql: Object.assign(
        jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
            kind: 'sql',
            strings: Array.from(strings),
            values,
        })),
        {
            placeholder: jest.fn((name: string) => ({
                kind: 'placeholder',
                name,
            })),
        }
    ),
};

export function mockDrizzleOrmModule() {
    return {
        and: (...conditions: unknown[]) => mockDrizzle.and(...conditions),
        desc: (value: unknown) => mockDrizzle.desc(value),
        eq: (left: unknown, right: unknown) => mockDrizzle.eq(left, right),
        inArray: (left: unknown, values: unknown[]) =>
            mockDrizzle.inArray(left, values),
        sql: Object.assign(
            (strings: TemplateStringsArray, ...values: unknown[]) =>
                mockDrizzle.sql(strings, ...values),
            {
                placeholder: (name: string) =>
                    mockDrizzle.sql.placeholder(name),
            }
        ),
    };
}

export function resetDrizzleMocks() {
    mockDrizzle.and.mockClear();
    mockDrizzle.desc.mockClear();
    mockDrizzle.eq.mockClear();
    mockDrizzle.inArray.mockClear();
    mockDrizzle.sql.mockClear();
    mockDrizzle.sql.placeholder.mockClear();
}

export type QueryMock = {
    from: jest.Mock;
    innerJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    then: (
        resolve: (value: unknown[]) => void,
        reject: (reason: unknown) => void
    ) => Promise<void>;
};

/**
 * Fluent AppDatabase mock. Each `db.select()` call consumes the next entry
 * of `selectResultsByCall` as its resolved rows; every builder method
 * returns the same chainable/thenable query object.
 */
export function createDbMock(selectResultsByCall: unknown[][] = []) {
    let selectIndex = 0;
    const queries: QueryMock[] = [];
    const select = jest.fn(() => {
        const rows = selectResultsByCall[selectIndex] ?? [];
        selectIndex += 1;
        const query: QueryMock = {
            from: jest.fn(),
            innerJoin: jest.fn(),
            where: jest.fn(),
            orderBy: jest.fn(),
            limit: jest.fn().mockResolvedValue(rows),
            then: (resolve, reject) =>
                Promise.resolve(rows).then(resolve, reject),
        };
        query.from.mockReturnValue(query);
        query.innerJoin.mockReturnValue(query);
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

    const deleteExecute = jest.fn().mockResolvedValue(undefined);
    const deletePrepare = jest
        .fn()
        .mockReturnValue({ execute: deleteExecute });
    const deleteResult = {
        prepare: deletePrepare,
        then: (
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void
        ) => Promise.resolve(undefined).then(resolve, reject),
    };
    const deleteWhere = jest.fn().mockReturnValue(deleteResult);
    const deleteFn = jest.fn().mockReturnValue({
        where: deleteWhere,
        then: (
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void
        ) => Promise.resolve(undefined).then(resolve, reject),
    });

    const transaction = jest.fn((callback: () => unknown) => {
        const result = callback();
        return Promise.resolve(result);
    });

    return {
        db: {
            select,
            insert,
            update,
            delete: deleteFn,
            transaction,
        } as unknown as AppDatabase,
        deleteExecute,
        deleteFn,
        deletePrepare,
        deleteWhere,
        insert,
        insertValues,
        queries,
        select,
        transaction,
        update,
        updateSet,
        updateWhere,
    };
}
