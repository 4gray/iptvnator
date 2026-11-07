import type Database from 'better-sqlite3';
import { SqliteHistoryLocalStore } from '@iptvnator/shared/database/history-sync';
import {
    parseHistoryScope,
    type HistoryLocalRequest,
} from '@iptvnator/shared/interfaces/history-sync';
export async function historyLocalOperation(
    db: Database.Database,
    request: HistoryLocalRequest
): Promise<unknown> {
    const scope = parseHistoryScope(request.scope);
    if (scope.instanceId !== request.instanceId)
        throw new Error('History profile mismatch');
    const store = new SqliteHistoryLocalStore(db, request.instanceId);
    if (request.operation === 'read') return store.read(scope);
    if (request.operation !== 'commit')
        throw new Error('Invalid history storage request');
    try {
        const value = await store.mutate(scope, (current) => {
            if ((current ? JSON.stringify(current) : null) !== request.expected)
                throw new Error('history_cas_conflict');
            return request.value;
        });
        return { value };
    } catch (error) {
        if (error instanceof Error && error.message === 'history_cas_conflict')
            return { conflict: true };
        throw new Error('History storage failed');
    }
}
