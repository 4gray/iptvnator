import type Database from 'better-sqlite3';
import {
    activityAddressKey,
    assertActivityLocalRecord,
    assertActivityToken,
    type ActivityAddress,
    type ActivityLocalRecord,
    type ActivityLocalStore,
    type ActivityPendingOperation,
} from '@iptvnator/shared/interfaces/activity-sync';
import { ensureActivitySchema } from './activity-schema';

/** Invoke in the database worker; no network I/O or asynchronous callbacks inside a transaction. */
export class SqliteActivityLocalStore implements ActivityLocalStore {
    constructor(
        private readonly database: Database.Database,
        private readonly instanceId: string
    ) {
        assertActivityToken(instanceId);
        ensureActivitySchema(database);
    }

    async read(address: ActivityAddress): Promise<ActivityLocalRecord | null> {
        return this.readKey(this.key(address));
    }

    async pending(): Promise<ActivityPendingOperation[]> {
        const rows = this.database
            .prepare(
                'SELECT value FROM activity_local_records WHERE instance_id = ? AND pending_count > 0 ORDER BY address_key'
            )
            .all(this.instanceId) as { value: string }[];
        return rows.flatMap(
            (row) => (JSON.parse(row.value) as ActivityLocalRecord).pending
        );
    }

    async mutate(
        address: ActivityAddress,
        change: (current: ActivityLocalRecord | null) => ActivityLocalRecord
    ): Promise<ActivityLocalRecord> {
        const key = this.key(address);
        return this.database.transaction(() => {
            const next = change(this.readKey(key));
            assertActivityLocalRecord(address, next);
            const value = JSON.stringify(next);
            this.database
                .prepare(
                    `INSERT INTO activity_local_records (address_key, instance_id, pending_count, address, source_id, value) VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT (address_key) DO UPDATE SET value = excluded.value, pending_count = excluded.pending_count`
                )
                .run(
                    key,
                    this.instanceId,
                    next.pending.length,
                    JSON.stringify(address),
                    address.sourceId,
                    value
                );
            return JSON.parse(value) as ActivityLocalRecord;
        })();
    }

    async entries(
        sourceId: string
    ): Promise<{ address: ActivityAddress; record: ActivityLocalRecord }[]> {
        const rows = this.database
            .prepare(
                'SELECT address, value FROM activity_local_records WHERE instance_id = ? AND source_id = ?'
            )
            .all(this.instanceId, sourceId) as {
            address: string;
            value: string;
        }[];
        return rows.map((row) => ({
            address: JSON.parse(row.address),
            record: JSON.parse(row.value),
        }));
    }

    private key(address: ActivityAddress): string {
        if (address.instanceId !== this.instanceId)
            throw new Error('Activity profile mismatch');
        return activityAddressKey(address);
    }

    private readKey(key: string): ActivityLocalRecord | null {
        const row = this.database
            .prepare(
                'SELECT value FROM activity_local_records WHERE address_key = ?'
            )
            .get(key) as { value: string } | undefined;
        return row ? JSON.parse(row.value) : null;
    }
}
