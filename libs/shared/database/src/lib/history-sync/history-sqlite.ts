import type Database from 'better-sqlite3';
import {
    historyScopeKey,
    parseHistoryOperation,
    assertHistoryRecord,
    emptyHistoryState,
    applyHistoryOperation,
    type HistoryScope,
    type HistoryState,
    type HistoryOperation,
    type HistoryResult,
    type HistoryStore,
    type HistoryRecord,
} from '@iptvnator/shared/interfaces/history-sync';
export function ensureHistorySchema(db: Database.Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS history_local_records (scope_key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history_server_states (scope_key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history_server_receipts (receipt_key TEXT PRIMARY KEY NOT NULL, scope_key TEXT NOT NULL, command TEXT NOT NULL, applied INTEGER NOT NULL, revision INTEGER NOT NULL);`);
}
export class SqliteHistoryLocalStore implements HistoryStore {
    constructor(
        private readonly db: Database.Database,
        private readonly instanceId: string
    ) {
        ensureHistorySchema(db);
    }
    async read(scope: HistoryScope): Promise<HistoryRecord | null> {
        const row = this.db
            .prepare(
                'SELECT value FROM history_local_records WHERE scope_key = ?'
            )
            .get(this.key(scope)) as { value: string } | undefined;
        return row ? JSON.parse(row.value) : null;
    }
    async mutate(
        scope: HistoryScope,
        change: (current: HistoryRecord | null) => HistoryRecord
    ): Promise<HistoryRecord> {
        const key = this.key(scope);
        return this.db.transaction(() => {
            const row = this.db
                .prepare(
                    'SELECT value FROM history_local_records WHERE scope_key = ?'
                )
                .get(key) as { value: string } | undefined;
            const next = change(row ? JSON.parse(row.value) : null);
            assertHistoryRecord(scope, next);
            const value = JSON.stringify(next);
            this.db
                .prepare(
                    'INSERT INTO history_local_records VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET value = excluded.value'
                )
                .run(key, value);
            return JSON.parse(value);
        })();
    }
    private key(scope: HistoryScope): string {
        if (scope.instanceId !== this.instanceId)
            throw new Error('History profile mismatch');
        return historyScopeKey(scope);
    }
}
/** Receipt decisions stay immutable; response snapshots always include the newest accepted state. */
export class SqliteHistoryServerStore {
    constructor(
        private readonly db: Database.Database,
        private readonly authorize: (scope: HistoryScope) => void
    ) {
        ensureHistorySchema(db);
    }
    read(scope: HistoryScope): HistoryState {
        this.allowed(scope);
        return this.readKey(historyScopeKey(scope));
    }
    apply(scope: HistoryScope, input: HistoryOperation): HistoryResult {
        const operation = parseHistoryOperation(input);
        return this.db.transaction(() => {
            this.allowed(scope);
            if (
                operation.reference &&
                operation.reference.provider !== scope.provider
            )
                throw new Error('History provider mismatch');
            const key = historyScopeKey(scope);
            const receiptKey = JSON.stringify([
                scope.instanceId,
                operation.deviceId,
                operation.operationId,
            ]);
            const command = JSON.stringify([key, operation]);
            const receipt = this.db
                .prepare(
                    'SELECT command, applied FROM history_server_receipts WHERE receipt_key = ?'
                )
                .get(receiptKey) as
                { command: string; applied: number } | undefined;
            if (receipt) {
                if (receipt.command !== command)
                    throw new Error('History operation ID reused');
                return { applied: !!receipt.applied, state: this.readKey(key) };
            }
            let baseRevision = operation.baseRevision;
            if (operation.after) {
                const predecessor = this.db
                    .prepare(
                        'SELECT revision, scope_key, applied FROM history_server_receipts WHERE receipt_key = ?'
                    )
                    .get(
                        JSON.stringify([
                            scope.instanceId,
                            operation.deviceId,
                            operation.after,
                        ])
                    ) as
                    | { revision: number; scope_key: string; applied: number }
                    | undefined;
                if (!predecessor || predecessor.scope_key !== key)
                    throw new Error('History predecessor unavailable');
                if (predecessor.applied)
                    baseRevision = Math.max(baseRevision, predecessor.revision);
            }
            const state = this.readKey(key);
            if (baseRevision > state.revision)
                throw new Error('History future revision');
            const now = state.items.reduce(
                (latest, item) => Math.max(latest, item.viewedAt + 1),
                Date.now()
            );
            const result = applyHistoryOperation(
                state,
                { ...operation, baseRevision },
                false,
                now
            );
            if (result.applied)
                this.db
                    .prepare(
                        'INSERT INTO history_server_states VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET value = excluded.value'
                    )
                    .run(key, JSON.stringify(result.state));
            this.db
                .prepare(
                    'INSERT INTO history_server_receipts VALUES (?, ?, ?, ?, ?)'
                )
                .run(
                    receiptKey,
                    key,
                    command,
                    Number(result.applied),
                    result.state.revision
                );
            return result;
        })();
    }
    private allowed(scope: HistoryScope): void {
        historyScopeKey(scope);
        if (this.authorize(scope) !== undefined)
            throw new Error('History authorization must be synchronous');
    }
    private readKey(key: string): HistoryState {
        const row = this.db
            .prepare(
                'SELECT value FROM history_server_states WHERE scope_key = ?'
            )
            .get(key) as { value: string } | undefined;
        return row ? JSON.parse(row.value) : emptyHistoryState();
    }
}
