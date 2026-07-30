export const SQL_TRACE_STATEMENT_TYPE = {
    SELECT: 'SELECT',
    INSERT: 'INSERT',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    REPLACE: 'REPLACE',
    CREATE: 'CREATE',
    ALTER: 'ALTER',
    DROP: 'DROP',
    PRAGMA: 'PRAGMA',
    WITH: 'WITH',
    BEGIN: 'BEGIN',
    COMMIT: 'COMMIT',
    ROLLBACK: 'ROLLBACK',
    SAVEPOINT: 'SAVEPOINT',
    RELEASE: 'RELEASE',
    VACUUM: 'VACUUM',
    ANALYZE: 'ANALYZE',
    REINDEX: 'REINDEX',
    ATTACH: 'ATTACH',
    DETACH: 'DETACH',
    EXPLAIN: 'EXPLAIN',
    OTHER: 'OTHER',
} as const;

export type SqlTraceStatementType =
    (typeof SQL_TRACE_STATEMENT_TYPE)[keyof typeof SQL_TRACE_STATEMENT_TYPE];

export interface SqlTraceSummary {
    statementType: SqlTraceStatementType;
}

const ALLOWED_STATEMENT_TYPES = new Set<SqlTraceStatementType>(
    Object.values(SQL_TRACE_STATEMENT_TYPE).filter(
        (statementType) =>
            statementType !== SQL_TRACE_STATEMENT_TYPE.OTHER
    ) as SqlTraceStatementType[]
);

const SQL_STATEMENT_PREFIX = /^\s*([A-Za-z]+)(?=[\s(;]|$)/;

export function summarizeSqlStatementForTrace(sql: unknown): SqlTraceSummary {
    if (typeof sql !== 'string') {
        return { statementType: SQL_TRACE_STATEMENT_TYPE.OTHER };
    }

    const match = SQL_STATEMENT_PREFIX.exec(sql);
    const candidate = match?.[1]?.toUpperCase() as
        | SqlTraceStatementType
        | undefined;

    return {
        statementType:
            candidate && ALLOWED_STATEMENT_TYPES.has(candidate)
                ? candidate
                : SQL_TRACE_STATEMENT_TYPE.OTHER,
    };
}
