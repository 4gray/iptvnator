import {
    setDatabaseConnectionObserver,
    type DatabaseConnectionObserver,
} from '@iptvnator/shared/database/connection-observer';
import { countSqlStatementExecutions } from '../workers/database-worker-sql-statement-count';
import { PERFORMANCE_COUNTER } from './performance-counters';
import type { PerformanceCounterRegistry } from './performance-counters';

/**
 * With IPTVNATOR_PERF_CAPTURE=1 and IPTVNATOR_PERF_COUNT_SQL=1, counts the
 * SQL statements the main process
 * executes into `main.sqlStatements`, next to the database worker's
 * statements that `DatabaseWorkerClient` adds. The shared connection
 * (`initDatabase`, the `sql-main` trace) runs schema creation and migrations
 * on the main thread before the first paint, so a worker-only count would
 * miss them.
 *
 * The hook is installed when that connection opens, before its first
 * statement, so better-sqlite3 is not loaded any earlier than without the
 * flag. It wraps the `Statement` prototype of this process, which also
 * counts statements of any other main-process connection opened later.
 */
export function countMainProcessSqlStatements(
    registry: PerformanceCounterRegistry,
    enabled: boolean,
    setObserver: (
        observer: DatabaseConnectionObserver | null
    ) => void = setDatabaseConnectionObserver
): void {
    if (!enabled) {
        return;
    }
    setObserver((connection) => {
        countSqlStatementExecutions(connection, () =>
            registry.increment(PERFORMANCE_COUNTER.SQL_STATEMENTS)
        );
    });
}
