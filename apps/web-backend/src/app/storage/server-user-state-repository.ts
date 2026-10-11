import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '@iptvnator/shared/database';
import {
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import { serverUserState } from './server-user-state.table';

/** Xtream PWA user data, one JSON value per namespace and playlist. */
export class ServerUserStateRepository {
    constructor(private readonly db: DatabaseInstance) {}

    all(): ServerUserStateResponse['entries'] {
        // Prototype-free buckets: a playlist id such as `__proto__` must be
        // stored as an own key, not change the bucket's prototype.
        const entries = Object.fromEntries(
            SERVER_USER_STATE_NAMESPACES.map((namespace) => [
                namespace,
                Object.create(null) as Record<string, unknown>,
            ])
        ) as ServerUserStateResponse['entries'];

        for (const row of this.db.select().from(serverUserState).all()) {
            const bucket = entries[row.namespace as ServerUserStateNamespace];
            if (bucket) {
                bucket[row.playlistId] = JSON.parse(row.value);
            }
        }
        return entries;
    }

    put(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown
    ): void {
        const serialized = JSON.stringify(value ?? null);
        const updatedAt = new Date().toISOString();
        this.db
            .insert(serverUserState)
            .values({ namespace, playlistId, value: serialized, updatedAt })
            .onConflictDoUpdate({
                target: [serverUserState.namespace, serverUserState.playlistId],
                set: { value: serialized, updatedAt },
            })
            .run();
    }

    delete(namespace: ServerUserStateNamespace, playlistId: string): void {
        this.db
            .delete(serverUserState)
            .where(
                and(
                    eq(serverUserState.namespace, namespace),
                    eq(serverUserState.playlistId, playlistId)
                )
            )
            .run();
    }

    deleteForPlaylist(playlistId: string): void {
        this.db
            .delete(serverUserState)
            .where(eq(serverUserState.playlistId, playlistId))
            .run();
    }

    deleteAll(): void {
        this.db.delete(serverUserState).run();
    }
}
