import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '@iptvnator/shared/database';
import {
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateCurrent,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import { serverUserState } from './server-user-state.table';

/**
 * What a conditional write is based on: `undefined` writes unconditionally,
 * `null` expects no entry, a string expects that tag.
 */
export type ExpectedTag = string | null | undefined;

export type ConditionalWriteResult =
    | { readonly tag: string | null }
    | { readonly conflict: ServerUserStateCurrent };

/** Version tag of a stored value: its content, so equal values match. */
export function userStateTag(serialized: string): string {
    return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

/** Xtream PWA user data, one JSON value per namespace and playlist. */
export class ServerUserStateRepository {
    constructor(private readonly db: DatabaseInstance) {}

    /** Every entry with its tag, as `GET /v1/user-state` serves them. */
    allWithTags(): Required<ServerUserStateResponse> {
        const tags = Object.fromEntries(
            SERVER_USER_STATE_NAMESPACES.map((namespace) => [
                namespace,
                Object.create(null) as Record<string, string>,
            ])
        ) as Required<ServerUserStateResponse>['tags'];
        for (const row of this.db.select().from(serverUserState).all()) {
            const bucket = tags[row.namespace as ServerUserStateNamespace];
            if (bucket) {
                bucket[row.playlistId] = userStateTag(row.value);
            }
        }
        return { entries: this.all(), tags };
    }

    /**
     * Writes (`value`) or deletes (`undefined`) one entry if it still has
     * the expected tag; otherwise reports the current entry. Synchronous on
     * the single connection, so the check and the write cannot interleave.
     */
    writeIf(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown,
        expected: ExpectedTag
    ): ConditionalWriteResult {
        if (expected !== undefined) {
            const row = this.db
                .select({ value: serverUserState.value })
                .from(serverUserState)
                .where(
                    and(
                        eq(serverUserState.namespace, namespace),
                        eq(serverUserState.playlistId, playlistId)
                    )
                )
                .get();
            const tag = row ? userStateTag(row.value) : null;
            if (tag !== expected) {
                return {
                    conflict: row
                        ? { value: JSON.parse(row.value), tag }
                        : { tag: null },
                };
            }
        }
        if (value === undefined) {
            this.delete(namespace, playlistId);
            return { tag: null };
        }
        return { tag: this.put(namespace, playlistId, value) };
    }

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

    /** Returns the stored value's tag. */
    put(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown
    ): string {
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
        return userStateTag(serialized);
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
