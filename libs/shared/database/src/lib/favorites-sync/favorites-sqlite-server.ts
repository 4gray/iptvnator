import type Database from 'better-sqlite3';
import {
    favoriteAddressKey,
    applyFavoriteOperation,
    emptyFavoriteState,
    type FavoriteAddress,
    type FavoriteResult,
    type FavoriteOperation,
    parseFavoriteOperation,
    type FavoriteState,
    type FavoriteSourceContext,
    type FavoriteList,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { ensureFavoriteSchema } from './favorites-schema';

/** No TTL on receipts/reset barriers: safe compaction needs a separate rebootstrap protocol. */
export class SqliteFavoriteServerStore {
    constructor(
        private readonly database: Database.Database,
        /** The runtime must check the selected instance and live source incarnation here. */
        private readonly assertAddressAllowed: (
            address: FavoriteAddress
        ) => void
    ) {
        ensureFavoriteSchema(database);
    }

    read(address: FavoriteAddress): FavoriteState {
        this.authorize(address);
        return this.readKey(favoriteAddressKey(address));
    }

    apply(
        address: FavoriteAddress,
        operation: FavoriteOperation
    ): FavoriteResult {
        return this.database.transaction(() => {
            this.authorize(address);
            const key = favoriteAddressKey(address);
            const receiptKey = JSON.stringify([
                address.instanceId,
                address.scope,
                operation.deviceId,
                operation.operationId,
            ]);
            const command = JSON.stringify([
                key,
                parseFavoriteOperation(operation),
            ]);
            const receipt = this.database
                .prepare(
                    'SELECT command, result FROM favorite_server_receipts WHERE receipt_key = ?'
                )
                .get(receiptKey) as
                { command: string; result: string } | undefined;
            if (receipt) {
                if (receipt.command !== command) {
                    throw new Error('Favorite operation ID reused');
                }
                return JSON.parse(receipt.result) as FavoriteResult;
            }
            const result = applyFavoriteOperation(this.readKey(key), operation);
            if (result.status === 'applied') {
                this.database
                    .prepare(
                        `INSERT INTO favorite_server_states (address_key, address, instance_id, source_id, source_incarnation, value) VALUES (?, ?, ?, ?, ?, ?)
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
                    'INSERT INTO favorite_server_receipts (receipt_key, command, result) VALUES (?, ?, ?)'
                )
                .run(receiptKey, command, JSON.stringify(result));
            return result;
        })();
    }

    list(
        instanceId: string,
        source: FavoriteSourceContext,
        cursor = ''
    ): FavoriteList {
        const rows = this.database
            .prepare(
                `SELECT address, value, address_key FROM favorite_server_states
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

    private authorize(address: FavoriteAddress): void {
        const result = this.assertAddressAllowed(address) as unknown;
        // TypeScript permits async functions where a void callback is expected.
        // Never treat an unfinished authorization Promise as permission to write.
        if (result !== undefined) {
            throw new Error('Favorite authorization must be synchronous');
        }
    }

    private readKey(key: string): FavoriteState {
        const row = this.database
            .prepare(
                'SELECT value FROM favorite_server_states WHERE address_key = ?'
            )
            .get(key) as { value: string } | undefined;
        return row ? JSON.parse(row.value) : emptyFavoriteState();
    }
}
