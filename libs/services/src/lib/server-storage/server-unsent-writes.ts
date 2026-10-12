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
