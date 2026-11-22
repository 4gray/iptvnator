import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';

// The slice of `node:sqlite` used here; the repository's @types/node
// predates the module.
type SQLInputValue = null | number | bigint | string | Uint8Array;
type Row = Record<string, unknown>;
interface StatementSync {
    get(...params: SQLInputValue[]): Row | undefined;
    all(...params: SQLInputValue[]): Row[];
    run(...params: SQLInputValue[]): unknown;
}
interface DatabaseSync {
    readonly isTransaction: boolean;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
}
const { DatabaseSync } = createRequire(__filename)('node:sqlite') as {
    DatabaseSync: new (path: string) => DatabaseSync;
};

/**
 * The subset of the better-sqlite3 API content-title-fts.ts uses, over
 * Node's built-in SQLite, so its scenarios run on a real engine inside the
 * Jest process (better-sqlite3 itself is built for Electron's ABI).
 * Rows are copied into plain objects of the calling realm, since Jest's
 * strict comparisons check prototypes.
 */
export function openNodeSqlite(path: string): Database.Database {
    const db = new DatabaseSync(path);
    const transaction = (fn: () => unknown) => {
        const run = (begin: string) => () => {
            // content-title-fts.ts never nests transactions.
            if (db.isTransaction) throw new Error('nested transaction');
            db.exec(begin);
            try {
                const result = fn();
                db.exec('COMMIT');
                return result;
            } catch (error) {
                if (db.isTransaction) db.exec('ROLLBACK');
                throw error;
            }
        };
        return Object.assign(run('BEGIN'), {
            immediate: run('BEGIN IMMEDIATE'),
        });
    };
    const rows = (list: Iterable<Row>) =>
        Array.from(list, (row) => ({ ...row }));
    const connection = {
        exec: (sql: string) => {
            db.exec(sql);
            return connection;
        },
        prepare: (sql: string) => {
            const statement = db.prepare(sql);
            return {
                get: (...params: SQLInputValue[]) => {
                    const row = statement.get(...params);
                    return row === undefined ? undefined : { ...row };
                },
                all: (...params: SQLInputValue[]) =>
                    rows(statement.all(...params)),
                run: (...params: SQLInputValue[]) => statement.run(...params),
            };
        },
        pragma: (source: string) => rows(db.prepare(`PRAGMA ${source}`).all()),
        transaction,
        close: () => db.close(),
    };
    return connection as unknown as Database.Database;
}
