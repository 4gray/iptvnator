import type BetterSqlite3 from 'better-sqlite3';

/**
 * Counts the SQL statements the database worker executes and reports the
 * count to the main process, where `main.sqlStatements` is kept (see
 * `services/performance-counters.ts`). Only active with
 * `IPTVNATOR_PERF_CAPTURE=1` and `IPTVNATOR_PERF_COUNT_SQL=1`, which only the
 * launch journey sets: the import benchmarks run with the capture flag alone
 * and keep measuring unwrapped statements.
 *
 * The count travels over the worker's message port, which is ordered with
 * the worker's responses, instead of the stdout trace lines Node forwards
 * asynchronously. Only a number crosses the port: no SQL text and no bound
 * values.
 *
 * Statements are counted at the execution methods of better-sqlite3's
 * `Statement` prototype rather than through the `verbose` callback behind
 * the SQL trace: with a callback, better-sqlite3 expands every statement's
 * SQL and calls into JavaScript with it, which made a 200,000-row insert
 * two to four times slower and would distort the import benchmarks that run
 * with the same flag. One call of `run`, `get`, `all` or `iterate` that
 * returns normally is one statement, which includes pragmas and the
 * BEGIN/COMMIT that `db.transaction()` prepares internally. One `exec` call
 * also counts as one: SQL cannot be split into statements reliably here
 * (trigger bodies contain semicolons), so callers pass one statement per
 * call. The database worker never calls `exec`, and the shared connection's
 * historical-upgrade test (`libs/shared/database/src/lib/testing/
 * connection-upgrade.ts`) fails on a batch. Calls that throw are not
 * counted: the SQL trace skips the
 * ones that fail before execution (a migration's `ALTER TABLE` for a column
 * that already exists), and they did no work.
 */
export const DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE =
    'performance-sql-statements';

export interface DbWorkerSqlStatementsMessage {
    type: typeof DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE;
    count: number;
}

export interface SqlStatementCountReporter {
    /** Counts one statement; it is posted on the next flush. */
    record(): void;
    /** Posts the statements recorded since the last flush, if any. */
    flush(): void;
}

const STATEMENT_EXECUTION_METHODS = ['run', 'get', 'all', 'iterate'] as const;
const COUNTED = Symbol.for('iptvnator.sqlStatementCount.counted');

type ExecutionMethod = ((...args: unknown[]) => unknown) & {
    [COUNTED]?: true;
};

/**
 * Coalesces counts into few messages. A flush is queued as a microtask, so
 * a bulk write posts one message rather than one per row; the worker also
 * flushes synchronously before posting any other message, so a response can
 * never overtake the statements that produced it.
 */
export function createSqlStatementCountReporter(
    post: (message: DbWorkerSqlStatementsMessage) => void,
    schedule: (callback: () => void) => void = queueMicrotask
): SqlStatementCountReporter {
    let pending = 0;
    let scheduled = false;

    const flush = (): void => {
        scheduled = false;
        if (pending === 0) {
            return;
        }
        const count = pending;
        pending = 0;
        post({ type: DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE, count });
    };

    return {
        record() {
            pending += 1;
            if (!scheduled) {
                scheduled = true;
                schedule(flush);
            }
        },
        flush,
    };
}

function wrapExecution(
    owner: Record<string, unknown>,
    method: string,
    record: () => void
): (() => void) | null {
    const original = owner[method] as ExecutionMethod | undefined;
    if (typeof original !== 'function' || original[COUNTED]) {
        return null;
    }
    const counted: ExecutionMethod = function countedExecution(
        this: unknown,
        ...args: unknown[]
    ) {
        const result = original.apply(this, args);
        record();
        return result;
    };
    counted[COUNTED] = true;
    owner[method] = counted;
    return () => {
        if (owner[method] === counted) {
            owner[method] = original;
        }
    };
}

/**
 * Wraps the execution methods of the connection's statements (shared by
 * every statement of this worker, since they have one prototype) and the
 * connection's own `exec`. Idempotent, so reopening the connection does not
 * count twice. Returns a function that removes the wrappers it installed.
 */
export function countSqlStatementExecutions(
    connection: BetterSqlite3.Database,
    record: () => void
): () => void {
    const statementPrototype = Object.getPrototypeOf(
        connection.prepare('SELECT 1')
    ) as Record<string, unknown>;
    const restores = [
        ...STATEMENT_EXECUTION_METHODS.map((method) =>
            wrapExecution(statementPrototype, method, record)
        ),
        wrapExecution(
            connection as unknown as Record<string, unknown>,
            'exec',
            record
        ),
    ];
    return () => {
        for (const restore of restores) {
            restore?.();
        }
    };
}

/** The count of a well-formed message, or null for anything else. */
export function readSqlStatementsMessageCount(message: unknown): number | null {
    if (typeof message !== 'object' || message === null) {
        return null;
    }
    const { type, count } = message as Partial<DbWorkerSqlStatementsMessage>;
    return type === DB_WORKER_SQL_STATEMENTS_MESSAGE_TYPE &&
        Number.isSafeInteger(count) &&
        (count as number) > 0
        ? (count as number)
        : null;
}
