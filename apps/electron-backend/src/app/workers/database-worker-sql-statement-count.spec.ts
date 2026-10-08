import Database from 'better-sqlite3';
import {
    countSqlStatementExecutions,
    createSqlStatementCountReporter,
    DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE,
    readSqlStatementsMessageCount,
    type DbWorkerSqlStatementsMessage,
} from './database-worker-sql-statement-count';

/** Runs every execution path the worker's connection uses. */
function runWorkload(db: Database.Database): void {
    db.pragma('foreign_keys = ON');
    db.prepare(
        'CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, secret TEXT)'
    ).run();
    const insert = db.prepare('INSERT INTO items (name, secret) VALUES (?, ?)');
    db.transaction((rows: string[]) => {
        for (const name of rows) {
            insert.run(name, 'statement-count-secret');
        }
    })(['a', 'b', 'c']);
    db.prepare('SELECT * FROM items WHERE id = ?').get(1);
    db.prepare('SELECT * FROM items').all();
    for (const row of db.prepare('SELECT id FROM items').iterate()) {
        void row;
    }
    db.exec('DELETE FROM items WHERE id = 3');
    try {
        // Fails before execution, like a repeated column migration.
        db.exec('ALTER TABLE items ADD COLUMN name TEXT');
    } catch {
        // Expected: duplicate column.
    }
    try {
        db.prepare('INSERT INTO items (id, name) VALUES (1, ?)').get('x');
    } catch {
        // Expected: get() on a statement that returns no data.
    }
}

describe('database worker SQL statement count', () => {
    const connections: Database.Database[] = [];
    const restores: Array<() => void> = [];

    function open(options?: Database.Options): Database.Database {
        const db = new Database(':memory:', options);
        connections.push(db);
        return db;
    }

    afterEach(() => {
        for (const restore of restores.splice(0).reverse()) {
            restore();
        }
        for (const db of connections.splice(0)) {
            db.close();
        }
    });

    it('counts exactly what the SQL trace callback sees, without SQL text', () => {
        const traced: string[] = [];
        runWorkload(open({ verbose: (sql) => traced.push(String(sql)) }));

        let counted = 0;
        const db = open();
        restores.push(
            countSqlStatementExecutions(db, () => {
                counted += 1;
            })
        );
        runWorkload(db);

        // pragma, CREATE, BEGIN, 3 inserts, COMMIT, get, all, iterate, exec
        expect(traced).toHaveLength(11);
        expect(counted).toBe(traced.length);
    });

    it('wraps once and restores the original methods', () => {
        const db = open();
        const statementPrototype = Object.getPrototypeOf(
            db.prepare('SELECT 1')
        ) as Record<string, unknown>;
        const originalRun = statementPrototype['run'];
        let counted = 0;
        const record = () => {
            counted += 1;
        };

        const restore = countSqlStatementExecutions(db, record);
        const second = countSqlStatementExecutions(db, record);
        db.prepare('SELECT 1').get();
        second();
        restore();
        db.prepare('SELECT 1').get();

        expect(counted).toBe(1);
        expect(statementPrototype['run']).toBe(originalRun);
    });

    it('coalesces statements into one message per flush', () => {
        const posted: DbWorkerSqlStatementsMessage[] = [];
        const scheduled: Array<() => void> = [];
        const reporter = createSqlStatementCountReporter(
            (message) => posted.push(message),
            (callback) => scheduled.push(callback)
        );

        reporter.record();
        reporter.record();
        reporter.record();
        expect(scheduled).toHaveLength(1);
        expect(posted).toEqual([]);

        scheduled[0]();
        reporter.flush();

        expect(posted).toEqual([
            { type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, count: 3 },
        ]);
    });

    it('posts pending statements before a synchronous response', () => {
        const order: string[] = [];
        const scheduled: Array<() => void> = [];
        const reporter = createSqlStatementCountReporter(
            (message) => order.push(`count:${message.count}`),
            (callback) => scheduled.push(callback)
        );

        reporter.record();
        reporter.record();
        // The worker's postMessage wrapper flushes before every message.
        reporter.flush();
        order.push('response');
        scheduled[0]();
        reporter.record();

        expect(order).toEqual(['count:2', 'response']);
        expect(scheduled).toHaveLength(2);
    });

    it('flushes on its own at the end of the current turn', async () => {
        const posted: DbWorkerSqlStatementsMessage[] = [];
        const reporter = createSqlStatementCountReporter((message) =>
            posted.push(message)
        );

        reporter.record();
        reporter.record();
        await Promise.resolve();

        expect(posted).toEqual([
            { type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, count: 2 },
        ]);
    });

    it('accepts only well-formed count messages', () => {
        expect(
            readSqlStatementsMessageCount({
                type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE,
                count: 7,
            })
        ).toBe(7);
        for (const invalid of [
            null,
            'performance-sql-statements',
            { type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE },
            { type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, count: 0 },
            { type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, count: -1 },
            { type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, count: 1.5 },
            { type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, count: '3' },
            { type: 'response', count: 3 },
        ]) {
            expect(readSqlStatementsMessageCount(invalid)).toBeNull();
        }
    });
});
