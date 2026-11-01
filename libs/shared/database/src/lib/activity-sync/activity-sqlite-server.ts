import type Database from 'better-sqlite3';
import {
    activityAddressKey,
    applyActivityOperation,
    emptyActivityState,
    type ActivityAddress,
    type ActivityApplyResult,
    type ActivityOperation,
    type ActivityState,
    type ActivitySourceContext,
    type ActivityListResponse,
} from '@iptvnator/shared/interfaces/activity-sync';
import { ensureActivitySchema } from './activity-schema';

/** No TTL on receipts/reset barriers: safe compaction needs a separate rebootstrap protocol. */
export class SqliteActivityServerStore {
    constructor(
        private readonly database: Database.Database,
        /** The runtime must check the selected instance and live source incarnation here. */
        private readonly assertAddressAllowed: (
            address: ActivityAddress
        ) => void
    ) {
        ensureActivitySchema(database);
    }

    read(address: ActivityAddress): ActivityState {
        this.authorize(address);
        return this.readKey(activityAddressKey(address));
    }

    apply(
        address: ActivityAddress,
        operation: ActivityOperation
    ): ActivityApplyResult {
        return this.database.transaction(() => {
            this.authorize(address);
            const key = activityAddressKey(address);
            const receiptKey = JSON.stringify([
                address.instanceId,
                address.scope,
                operation.deviceId,
                operation.operationId,
            ]);
            const command = JSON.stringify([
                key,
                canonicalOperation(operation),
            ]);
            const receipt = this.database
                .prepare(
                    'SELECT command, result FROM activity_server_receipts WHERE receipt_key = ?'
                )
                .get(receiptKey) as
                { command: string; result: string } | undefined;
            if (receipt) {
                if (receipt.command !== command) {
                    throw new Error('Activity operation ID reused');
                }
                return JSON.parse(receipt.result) as ActivityApplyResult;
            }
            const result = applyActivityOperation(this.readKey(key), operation);
            if (result.status === 'applied') {
                result.state.updatedAt = new Date().toISOString();
                this.database
                    .prepare(
                        `INSERT INTO activity_server_states (address_key, address, instance_id, source_id, source_incarnation, value) VALUES (?, ?, ?, ?, ?, ?)
                         ON CONFLICT (address_key) DO UPDATE SET value = excluded.value`
                    )
                    .run(
                        key,
                        JSON.stringify(address),
                        address.instanceId,
                        address.sourceId,
                        address.sourceIncarnation,
                        JSON.stringify(result.state)
                    );
            }
            this.database
                .prepare(
                    'INSERT INTO activity_server_receipts (receipt_key, command, result) VALUES (?, ?, ?)'
                )
                .run(receiptKey, command, JSON.stringify(result));
            return result;
        })();
    }

    list(
        instanceId: string,
        source: ActivitySourceContext,
        cursor = ''
    ): ActivityListResponse {
        const rows = this.database
            .prepare(
                `SELECT address, value, address_key FROM activity_server_states
             WHERE instance_id = ? AND source_id = ? AND source_incarnation = ? AND address_key > ?
             ORDER BY address_key LIMIT 101`
            )
            .all(
                instanceId,
                source.sourceId,
                source.sourceIncarnation,
                cursor
            ) as { address: string; value: string; address_key: string }[];
        const page = rows.slice(0, 100);
        return {
            entries: page.map((row) => ({
                address: JSON.parse(row.address),
                state: JSON.parse(row.value),
            })),
            ...(rows.length > 100 ? { cursor: page[99].address_key } : {}),
        };
    }

    private authorize(address: ActivityAddress): void {
        const result = this.assertAddressAllowed(address) as unknown;
        // TypeScript permits async functions where a void callback is expected.
        // Never treat an unfinished authorization Promise as permission to write.
        if (result !== undefined) {
            throw new Error('Activity authorization must be synchronous');
        }
    }

    private readKey(key: string): ActivityState {
        const row = this.database
            .prepare(
                'SELECT value FROM activity_server_states WHERE address_key = ?'
            )
            .get(key) as { value: string } | undefined;
        return row ? JSON.parse(row.value) : emptyActivityState();
    }
}

/** Property order and irrelevant snapshot fields never change the identity of a retry. */
function canonicalOperation(operation: ActivityOperation): unknown[] {
    const meta = operation.positionMetadata;
    const base = [
        operation.kind,
        operation.operationId,
        operation.deviceId,
        meta?.contentXtreamId ?? null,
        meta?.title ?? null,
        meta?.seriesXtreamId ?? null,
        meta?.seasonNumber ?? null,
        meta?.episodeNumber ?? null,
    ];
    if (operation.kind === 'import')
        return [
            ...base,
            operation.expectedRevision,
            operation.resume?.positionSeconds ?? null,
            operation.resume?.durationSeconds ?? null,
            operation.watched,
        ];
    if (operation.kind === 'checkpoint') {
        return [
            ...base,
            operation.generation,
            operation.sessionId,
            operation.sequence,
            operation.resume.positionSeconds,
            operation.resume.durationSeconds ?? null,
        ];
    }
    return [
        ...base,
        operation.expectedRevision,
        ...(operation.kind === 'begin' ? [operation.sessionId] : []),
    ];
}
