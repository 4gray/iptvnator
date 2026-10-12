import {
    isServerUserStateNamespace,
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';

/**
 * User-data writes the server has not confirmed, kept across reloads: a
 * failed write, or a page-hide write whose answer the page did not live to
 * see, is sent again on the next visit instead of being replaced by the
 * server's older value.
 */
export const UNSENT_WRITES_KEY = 'iptvnator-server:unsent-writes';
/** Which server database the cached user data belongs to. */
export const CACHE_OWNER_KEY = 'iptvnator-server:cache-owner';

const writesKey = (instanceId: string) => `${UNSENT_WRITES_KEY}:${instanceId}`;
/** Edits made before the first read of a visit, kept as before → after. */
export const DEFERRED_EDITS_KEY = 'iptvnator-server:deferred-edits';
const deferredKey = (instanceId: string) =>
    `${DEFERRED_EDITS_KEY}:${instanceId}`;

/**
 * Another database behind this address (a new volume, another backend):
 * its cache and unsent writes belong to the old one and must not be sent
 * to or shown for this one.
 */
export function claimCache(local: UserDataStorage, instanceId: string): void {
    try {
        const owner = local.getItem(CACHE_OWNER_KEY);
        if (owner === instanceId) {
            return;
        }
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            local.removeItem(`iptvnator-server:${namespace}`);
        }
        if (owner) {
            local.removeItem(writesKey(owner));
            local.removeItem(deferredKey(owner));
        }
        local.setItem(CACHE_OWNER_KEY, instanceId);
    } catch {
        // Storage unavailable: nothing cached to mix up.
    }
}

export interface UnsentWrite {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    /** `undefined` deletes the entry. */
    readonly value: unknown;
}

interface StoredWrite {
    readonly namespace: string;
    readonly playlistId: string;
    readonly value?: unknown;
    readonly remove?: true;
}

export function readUnsentWrites(
    local: UserDataStorage,
    instanceId: string
): UnsentWrite[] {
    let stored: unknown;
    try {
        stored = JSON.parse(local.getItem(writesKey(instanceId)) ?? '[]');
    } catch {
        return [];
    }
    const writes: UnsentWrite[] = [];
    for (const write of Array.isArray(stored)
        ? (stored as StoredWrite[])
        : []) {
        if (
            write &&
            isServerUserStateNamespace(write.namespace) &&
            typeof write.playlistId === 'string'
        ) {
            writes.push({
                namespace: write.namespace,
                playlistId: write.playlistId,
                value: write.remove ? undefined : write.value,
            });
        }
    }
    return writes;
}

export function saveUnsentWrites(
    local: UserDataStorage,
    instanceId: string,
    writes: readonly UnsentWrite[]
): void {
    try {
        if (writes.length === 0) {
            local.removeItem(writesKey(instanceId));
            return;
        }
        const stored: StoredWrite[] = writes.map(
            ({ namespace, playlistId, value }) =>
                value === undefined
                    ? { namespace, playlistId, remove: true }
                    : { namespace, playlistId, value }
        );
        local.setItem(writesKey(instanceId), JSON.stringify(stored));
    } catch {
        // Storage unavailable or full: the queue stays in memory only.
    }
}

/** One write per entry, the newest by edit number. */
export function newestWrites<T extends UnsentWrite & { readonly edit: number }>(
    writes: readonly T[]
): T[] {
    const newest = new Map<string, T>();
    for (const write of writes) {
        const key = `${write.namespace}|${write.playlistId}`;
        const known = newest.get(key);
        if (!known || write.edit > known.edit) {
            newest.set(key, write);
        }
    }
    return [...newest.values()];
}

export interface SavedDeferredEdit {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    readonly before: unknown;
    readonly after: unknown;
}

export function readDeferredEdits(
    local: UserDataStorage,
    instanceId: string
): SavedDeferredEdit[] {
    let stored: unknown;
    try {
        stored = JSON.parse(local.getItem(deferredKey(instanceId)) ?? '[]');
    } catch {
        return [];
    }
    const edits: SavedDeferredEdit[] = [];
    for (const edit of Array.isArray(stored)
        ? (stored as Record<string, unknown>[])
        : []) {
        const namespace = edit?.['namespace'];
        const playlistId = edit?.['playlistId'];
        if (
            typeof namespace === 'string' &&
            isServerUserStateNamespace(namespace) &&
            typeof playlistId === 'string'
        ) {
            // JSON has no undefined: absent sides are flagged.
            edits.push({
                namespace,
                playlistId,
                before: edit['noBefore'] ? undefined : edit['before'],
                after: edit['noAfter'] ? undefined : edit['after'],
            });
        }
    }
    return edits;
}

export function saveDeferredEdits(
    local: UserDataStorage,
    instanceId: string,
    edits: readonly SavedDeferredEdit[]
): void {
    try {
        if (edits.length === 0) {
            local.removeItem(deferredKey(instanceId));
            return;
        }
        local.setItem(
            deferredKey(instanceId),
            JSON.stringify(
                edits.map((edit) => ({
                    namespace: edit.namespace,
                    playlistId: edit.playlistId,
                    ...(edit.before === undefined
                        ? { noBefore: true }
                        : { before: edit.before }),
                    ...(edit.after === undefined
                        ? { noAfter: true }
                        : { after: edit.after }),
                }))
            )
        );
    } catch {
        // Storage unavailable or full: the edits stay in memory only.
    }
}
