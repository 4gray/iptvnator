import { favoriteReferenceKey } from '@iptvnator/shared/interfaces/favorites-sync';
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
        CREATE TABLE IF NOT EXISTS history_server_receipts (receipt_key TEXT PRIMARY KEY NOT NULL, scope_key TEXT NOT NULL, command TEXT NOT NULL, applied INTEGER NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS history_server_clocks (instance_id TEXT PRIMARY KEY NOT NULL, viewed_at INTEGER NOT NULL);`);
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
                        'SELECT revision, scope_key, applied, command FROM history_server_receipts WHERE receipt_key = ?'
                    )
                    .get(
                        JSON.stringify([
                            scope.instanceId,
                            operation.deviceId,
                            operation.after,
                        ])
                    ) as
                    | {
                          revision: number;
                          scope_key: string;
                          applied: number;
                          command: string;
                      }
                    | undefined;
                if (!predecessor || predecessor.scope_key !== key)
                    throw new Error('History predecessor unavailable');
                const prior = JSON.parse(
                    predecessor.command
                )[1] as HistoryOperation;
                if (
                    predecessor.applied &&
                    (prior.kind === 'clear' ||
                        (prior.kind === 'remove' &&
                            prior.reference &&
                            operation.reference &&
                            favoriteReferenceKey(prior.reference) ===
                                favoriteReferenceKey(operation.reference)))
                )
                    baseRevision = Math.max(baseRevision, predecessor.revision);
            }
            const state = this.readKey(key);
            if (baseRevision > state.revision)
                throw new Error('History future revision');
            const now = this.nextTime(scope.instanceId);
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
    private nextTime(instanceId: string): number {
        const clock = this.db
            .prepare(
                'SELECT viewed_at FROM history_server_clocks WHERE instance_id = ?'
            )
            .get(instanceId) as { viewed_at: number } | undefined;
        // Seed once from pre-clock states; normal writes read one indexed clock row.
        const previous =
            clock?.viewed_at ??
            (
                this.db
                    .prepare(
                        `SELECT MAX(json_extract(item.value, '$.viewedAt')) AS viewed_at
             FROM history_server_states, json_each(history_server_states.value, '$.items') AS item
             WHERE json_extract(history_server_states.scope_key, '$[0]') = ?`
                    )
                    .get(instanceId) as { viewed_at: number | null }
            ).viewed_at ??
            0;
        const now = Math.max(Date.now(), previous + 1);
        if (!Number.isSafeInteger(now))
            throw new Error('History timestamp exhausted');
        this.db
            .prepare(
                'INSERT INTO history_server_clocks VALUES (?, ?) ON CONFLICT(instance_id) DO UPDATE SET viewed_at = excluded.viewed_at'
            )
            .run(instanceId, now);
        return now;
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
