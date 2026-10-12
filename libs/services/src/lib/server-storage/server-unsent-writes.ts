import {
    isServerUserStateNamespace,
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

export function readUnsentWrites(local: UserDataStorage): UnsentWrite[] {
    let stored: unknown;
    try {
        stored = JSON.parse(local.getItem(UNSENT_WRITES_KEY) ?? '[]');
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
    writes: readonly UnsentWrite[]
): void {
    try {
        if (writes.length === 0) {
            local.removeItem(UNSENT_WRITES_KEY);
            return;
        }
        const stored: StoredWrite[] = writes.map(
            ({ namespace, playlistId, value }) =>
                value === undefined
                    ? { namespace, playlistId, remove: true }
                    : { namespace, playlistId, value }
        );
        local.setItem(UNSENT_WRITES_KEY, JSON.stringify(stored));
    } catch {
        // Storage unavailable or full: the queue stays in memory only.
    }
}
