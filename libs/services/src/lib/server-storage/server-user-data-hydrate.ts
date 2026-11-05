import {
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import { extendUnsent } from './server-user-data-adopt';
import type { UserDataCache } from './server-user-data-cache';
import { type DeferredEdit, refreshedNamespace } from './server-user-data-edit';
import { idMap, splitEditKey, UNKNOWN_TAG } from './server-user-data-entries';
import type { UserDataWriteQueue } from './server-user-data-queue';

/** A server read as it went into the cache, for the early edits. */
export interface ServerRead {
    /** Edits made before the first read, as they were when it arrived. */
    readonly deferred: readonly DeferredEdit[];
    /** This tab's own unsent writes (recovered after a reload). */
    readonly own: ReadonlySet<string>;
    /** What each early edit was made on, by entry key. */
    readonly base: ReadonlyMap<string, unknown>;
    /** The maps now cached, by namespace. */
    readonly refreshed: ReadonlyMap<string, Record<string, unknown>>;
}

/**
 * Replaces the cache with the server's maps, except the entries in
 * `unsaved`, whose value the server does not have yet; early edits are
 * applied on top. A kept entry's next write must conflict and replay.
 */
export function applyServerRead(
    writes: UserDataWriteQueue,
    cache: UserDataCache,
    edits: ReadonlyMap<string, DeferredEdit>,
    { entries, tags }: ServerUserStateResponse,
    unsaved: ReadonlySet<string>
): ServerRead {
    const deferred = [...edits.values()];
    // This tab's own unsent writes (recovered after a reload): an early
    // edit was made on them, not on the server's value.
    const own = new Set(writes.unconfirmedKeys());
    const base = new Map<string, unknown>();
    const refreshed = new Map<string, Record<string, unknown>>();
    for (const namespace of SERVER_USER_STATE_NAMESPACES) {
        const keepCached = new Set<string>();
        for (const key of unsaved) {
            const [editedNamespace, playlistId] = splitEditKey(key);
            if (editedNamespace === namespace) {
                keepCached.add(playlistId);
            }
        }
        const cached = cache.map(namespace);
        const early = deferred.filter((edit) => edit.namespace === namespace);
        for (const { playlistId } of early) {
            const key = `${namespace}|${playlistId}`;
            base.set(
                key,
                own.has(key)
                    ? writes.unsent(key)?.value
                    : entries[namespace]?.[playlistId]
            );
        }
        const value = refreshedNamespace(
            entries[namespace] ?? {},
            cached,
            keepCached,
            early,
            (playlistId) => base.get(`${namespace}|${playlistId}`)
        );
        refreshed.set(namespace, value);
        // A value too big for browser storage stays readable in memory,
        // so callers and the diff baseline see the same map.
        cache.write(namespace, JSON.stringify(value));
        if (tags) {
            // A kept value is not what the server's tag describes: its
            // next write must conflict and be replayed on the server's.
            const fresh = idMap(tags[namespace]);
            for (const playlistId of keepCached) {
                fresh[playlistId] = UNKNOWN_TAG;
            }
            writes.tags.set(namespace, fresh);
        }
    }
    return { deferred, own, base, refreshed };
}

/**
 * After the first read: the early edits join the queue, on this tab's
 * recovered unsent write they were made on, or on the server's value.
 */
export function queueEarlyEdits(
    writes: UserDataWriteQueue,
    { deferred, own, base, refreshed }: ServerRead
): void {
    for (const edit of deferred) {
        const key = `${edit.namespace}|${edit.playlistId}`;
        if (own.has(key)) {
            extendUnsent(writes, key, edit.steps);
        } else {
            writes.queue(
                edit.namespace,
                edit.playlistId,
                refreshed.get(edit.namespace)?.[edit.playlistId],
                base.get(key)
            );
        }
    }
}
