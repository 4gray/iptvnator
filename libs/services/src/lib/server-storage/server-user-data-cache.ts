import {
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';
import { changedEntries } from './server-user-data-edit';
import { parseMap } from './server-user-data-entries';

/** Server-mode cache keys; the legacy unprefixed keys are never touched. */
export const SERVER_CACHE_PREFIX = 'iptvnator-server:cache';

/**
 * One namespace's cache of one server instance: a tab still open on
 * another server (a changed backend URL) never writes over it.
 */
export function cacheKey(
    instanceId: string,
    namespace: ServerUserStateNamespace
): string {
    return `${SERVER_CACHE_PREFIX}:${instanceId}:${namespace}`;
}

/**
 * The synced namespaces as this browser shows them: in browser storage,
 * shared by the tabs, or in memory when it is full or refuses access, so
 * callers and the diff baseline always read the same map.
 */
export class UserDataCache {
    private readonly overflow = new Map<ServerUserStateNamespace, string>();

    constructor(
        private readonly local: UserDataStorage,
        private readonly instanceId: string
    ) {}

    read(namespace: ServerUserStateNamespace): string | null {
        const kept = this.overflow.get(namespace);
        if (kept !== undefined) {
            return kept;
        }
        try {
            return this.local.getItem(cacheKey(this.instanceId, namespace));
        } catch {
            return null;
        }
    }

    /** `null` empties the namespace. */
    write(namespace: ServerUserStateNamespace, value: string | null): void {
        try {
            const key = cacheKey(this.instanceId, namespace);
            if (value === null) {
                this.local.removeItem(key);
            } else {
                this.local.setItem(key, value);
            }
            this.overflow.delete(namespace);
        } catch {
            this.overflow.set(namespace, value ?? '{}');
        }
    }

    /** What every namespace holds now, to compare with later. */
    snapshot(): Map<ServerUserStateNamespace, string | null> {
        return new Map(
            SERVER_USER_STATE_NAMESPACES.map((namespace) => [
                namespace,
                this.read(namespace),
            ])
        );
    }

    /** Entries (`namespace|playlistId`) changed since `snapshot`. */
    changedSince(
        snapshot: ReadonlyMap<ServerUserStateNamespace, string | null>
    ): string[] {
        const keys: string[] = [];
        for (const [namespace, before] of snapshot) {
            if (this.read(namespace) !== before) {
                for (const [playlistId] of changedEntries(
                    parseMap(before ?? '{}'),
                    this.map(namespace)
                )) {
                    keys.push(`${namespace}|${playlistId}`);
                }
            }
        }
        return keys;
    }

    map(namespace: ServerUserStateNamespace): Record<string, unknown> {
        return parseMap(this.read(namespace) ?? '{}');
    }

    /** After a delete: one playlist's entries, without an id all of them. */
    forget(playlistId?: string): void {
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const map = this.map(namespace);
            if (playlistId === undefined) {
                this.write(namespace, null);
            } else if (playlistId in map) {
                delete map[playlistId];
                this.write(namespace, JSON.stringify(map));
            }
        }
    }

    /** `undefined` removes the playlist's entry. */
    setEntry(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown
    ): void {
        const map = this.map(namespace);
        if (value === undefined) {
            delete map[playlistId];
        } else {
            map[playlistId] = value;
        }
        this.write(namespace, JSON.stringify(map));
    }
}
