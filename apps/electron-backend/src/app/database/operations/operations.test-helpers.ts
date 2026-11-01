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
    like: jest.fn((left: unknown, right: unknown) => ({
        kind: 'like',
        left,
        right,
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
        like: (left: unknown, right: unknown) => mockDrizzle.like(left, right),
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
    mockDrizzle.like.mockClear();
    mockDrizzle.sql.mockClear();
    mockDrizzle.sql.placeholder.mockClear();
}

export type QueryMock = {
    from: jest.Mock;
    innerJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    all: jest.Mock;
    get: jest.Mock;
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
            limit: jest.fn(),
            all: jest.fn().mockReturnValue(rows),
            get: jest.fn().mockReturnValue(rows[0]),
            then: (resolve, reject) =>
                Promise.resolve(rows).then(resolve, reject),
        };
        query.from.mockReturnValue(query);
        query.innerJoin.mockReturnValue(query);
        query.where.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);
        query.limit.mockReturnValue(query);
        queries.push(query);
        return query;
    });

    // Same `.run()` requirement as the update below: an insert executed inside
    // a synchronous transaction callback has to be the synchronous form.
    const insertRun = jest.fn();
    const insertChain: Record<string, unknown> = {
        run: insertRun,
        then: (
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void
        ) => Promise.resolve(undefined).then(resolve, reject),
    };
    insertChain.onConflictDoUpdate = jest.fn().mockReturnValue(insertChain);
    const insertValues = jest.fn().mockReturnValue(insertChain);
    const insert = jest.fn().mockReturnValue({ values: insertValues });

    // Prepared-statement writes MUST use `.run()` (synchronous) rather than
    // `.execute()` inside a synchronous `db.transaction()` callback — the
    // better-sqlite3 driver's `.execute()` defers to a promise that never
    // settles before COMMIT, silently dropping the write (issue #1137). The
    // mock exposes both so specs can assert the correct method is used.
    const updateRun = jest.fn();
    const updateExecute = jest.fn().mockResolvedValue(undefined);
    const updatePrepare = jest
        .fn()
        .mockReturnValue({ run: updateRun, execute: updateExecute });
    const updateWhere = jest.fn().mockReturnValue({
        run: updateRun,
        prepare: updatePrepare,
        then: (
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void
        ) => Promise.resolve(undefined).then(resolve, reject),
    });
    const updateSet = jest.fn().mockReturnValue({ where: updateWhere });
    const update = jest.fn().mockReturnValue({ set: updateSet });

    const deleteRun = jest.fn();
    const deleteExecute = jest.fn().mockResolvedValue(undefined);
    const deletePrepare = jest
        .fn()
        .mockReturnValue({ execute: deleteExecute, run: deleteRun });
    const deleteResult = {
        // Inside a transaction the delete must be the synchronous form too.
        run: deleteRun,
        prepare: deletePrepare,
        then: (
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void
        ) => Promise.resolve(undefined).then(resolve, reject),
    };
    const deleteWhere = jest.fn().mockReturnValue(deleteResult);
    const deleteFn = jest.fn().mockReturnValue({
        run: deleteRun,
        where: deleteWhere,
        then: (
            resolve: (value: unknown) => void,
            reject: (reason: unknown) => void
        ) => Promise.resolve(undefined).then(resolve, reject),
    });

    const transaction = jest.fn((callback: (tx: AppDatabase) => unknown) =>
        callback(database)
    );
    const database = {
        select,
        insert,
        update,
        delete: deleteFn,
        transaction,
    } as unknown as AppDatabase;

    return {
        db: database,
        deleteExecute,
        deleteFn,
        deletePrepare,
        deleteRun,
        insertRun,
        deleteWhere,
        insert,
        insertValues,
        queries,
        select,
        transaction,
        update,
        updatePrepare,
        updateRun,
        updateExecute,
        updateSet,
        updateWhere,
    };
}
