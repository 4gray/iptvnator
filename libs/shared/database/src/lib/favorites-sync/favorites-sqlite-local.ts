import { assertActivityToken } from '@iptvnator/shared/interfaces/activity-sync';
import type Database from 'better-sqlite3';
import {
    favoriteAddressKey,
    assertFavoriteLocalRecord,
    type FavoriteAddress,
    type FavoriteLocalRecord,
    type FavoriteLocalStore,
    type FavoritePending,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { ensureFavoriteSchema } from './favorites-schema';

/** Invoke in the database worker; no network I/O or asynchronous callbacks inside a transaction. */
export class SqliteFavoriteLocalStore implements FavoriteLocalStore {
    constructor(
        private readonly database: Database.Database,
        private readonly instanceId: string
    ) {
        assertActivityToken(instanceId);
        ensureFavoriteSchema(database);
    }

    async read(address: FavoriteAddress): Promise<FavoriteLocalRecord | null> {
        return this.readKey(this.key(address));
    }

    async pending(): Promise<FavoritePending[]> {
        const rows = this.database
            .prepare(
                'SELECT value FROM favorite_local_records WHERE instance_id = ? AND pending_count > 0 ORDER BY address_key'
            )
            .all(this.instanceId) as { value: string }[];
        return rows.flatMap(
            (row) => (JSON.parse(row.value) as FavoriteLocalRecord).pending
        );
    }

    async mutate(
        address: FavoriteAddress,
        change: (current: FavoriteLocalRecord | null) => FavoriteLocalRecord
    ): Promise<FavoriteLocalRecord> {
        const key = this.key(address);
        return this.database.transaction(() => {
            const next = change(this.readKey(key));
            assertFavoriteLocalRecord(address, next);
            const value = JSON.stringify(next);
            this.database
                .prepare(
                    `INSERT INTO favorite_local_records (address_key, instance_id, pending_count, address, source_id, value) VALUES (?, ?, ?, ?, ?, ?)
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
            return JSON.parse(value) as FavoriteLocalRecord;
        })();
    }

    async entries(
        sourceId: string
    ): Promise<{ address: FavoriteAddress; record: FavoriteLocalRecord }[]> {
        const rows = this.database
            .prepare(
                'SELECT address, value FROM favorite_local_records WHERE instance_id = ? AND source_id = ?'
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

    private key(address: FavoriteAddress): string {
        if (address.instanceId !== this.instanceId)
            throw new Error('Favorite profile mismatch');
        return favoriteAddressKey(address);
    }

    private readKey(key: string): FavoriteLocalRecord | null {
        const row = this.database
            .prepare(
                'SELECT value FROM favorite_local_records WHERE address_key = ?'
            )
            .get(key) as { value: string } | undefined;
        return row ? JSON.parse(row.value) : null;
    }
}
