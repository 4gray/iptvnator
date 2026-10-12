import {
    isServerUserStateNamespace,
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';
import type { ServerApiClient } from './server-api-client';
import { parseMap, splitEditKey } from './server-user-data-entries';
import { type DeferredEdit, refreshedNamespace } from './server-user-data-edit';
import { UserDataWriteQueue } from './server-user-data-queue';
import {
    claimCache,
    markUnconfirmed,
    othersUnconfirmed,
    readDeferredEdits,
    readUnsentWrites,
    saveDeferredEdits,
    saveUnsentWrites,
} from './server-unsent-writes';

/** Server-mode cache keys; the legacy unprefixed keys are never touched. */
export const SERVER_CACHE_PREFIX = 'iptvnator-server:';

type ServerApi = Pick<
    ServerApiClient,
    'getJson' | 'readJson' | 'sendJson' | 'request' | 'sendKeepalive'
>;

/**
 * Write-through `USER_DATA_STORAGE` for server mode. Synced namespaces are
 * maps keyed by playlist id; a write compares the new map with the one the
 * caller read and sends only the playlist entries that changed, each based
 * on the server version it was read at. When another device changed the
 * entry meanwhile, the server answers `412` and the edit is replayed on its
 * current value (`UserDataWriteQueue`). Other keys use plain storage.
 */
export class ServerUserDataStorage implements UserDataStorage {
    private readonly writes: UserDataWriteQueue;
    private unsentSaved = false;
    /**
     * Edits made before the first successful read, as before → after: the
     * cache they were made against may be empty or old, so they are
     * applied to the server's value once it is known (`applyEdit`).
     */
    private readonly deferred = new Map<string, DeferredEdit>();
    private hydrated = false;
    /** This tab, in the shared registry of unconfirmed entries. */
    private readonly tabId = Math.random().toString(36).slice(2);
    /** Cache values that did not fit into browser storage. */
    private readonly overflow = new Map<ServerUserStateNamespace, string>();
    /** Re-reads run one at a time, so an older one never lands last. */
    private hydration: Promise<void> = Promise.resolve();

    constructor(
        private readonly api: ServerApi,
        private readonly local: UserDataStorage,
        onWriteFailure: (error: unknown) => void,
        /** Scopes the cache and saved writes to one server database. */
        private readonly instanceId = 'default',
        /**
         * Where this tab keeps what the server has not confirmed: its own
         * (`sessionStorage` in the app), so tabs never clear each other's,
         * and a reload of the tab finds it again.
         */
        private readonly tabStore: UserDataStorage = local
    ) {
        this.writes = new UserDataWriteQueue(api, {
            changed: () => this.saveUnsent(),
            show: (namespace, playlistId, value) =>
                this.showEntry(namespace, playlistId, value),
            writeFailed: onWriteFailure,
        });
        claimCache(local, instanceId);
        // Writes a previous visit could not confirm go out with the first
        // flush, and the first read keeps them.
        for (const write of readUnsentWrites(tabStore, instanceId)) {
            this.writes.queue(
                write.namespace,
                write.playlistId,
                write.value,
                write.before,
                write.tag
            );
        }
        this.unsentSaved = this.writes.hasUnsent();
        for (const edit of readDeferredEdits(tabStore, instanceId)) {
            this.deferred.set(`${edit.namespace}|${edit.playlistId}`, edit);
        }
    }

    /** Whether a write is queued, being retried, or still travelling. */
    hasUnsentWrites(): boolean {
        return this.writes.hasUnsent() || this.deferred.size > 0;
    }

    getItem(key: string): string | null {
        return this.isSynced(key)
            ? this.readCache(key)
            : this.local.getItem(key);
    }

    setItem(key: string, value: string): void {
        if (!this.isSynced(key)) {
            this.local.setItem(key, value);
            return;
        }
        const before = this.baseline(key);
        this.writeCache(key, value);
        this.queueChanges(key, parseMap(value), before);
    }

    removeItem(key: string): void {
        if (!this.isSynced(key)) {
            this.local.removeItem(key);
            return;
        }
        const before = this.baseline(key);
        this.writeCache(key, null);
        this.queueChanges(key, {}, before);
    }

    /**
     * Replaces the cache with the server's data, after sending pending
     * writes. Entries edited while the read was in flight, and entries whose
     * write failed, keep their local value: the server does not have it yet.
     */
    hydrate(): Promise<void> {
        const run = this.hydration.then(() => this.hydrateNow());
        this.hydration = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    /** Sends the queued entries after any batch still travelling. */
    flush(): Promise<void> {
        return this.writes.flush();
    }

    /** Page hide: sends the queue with requests that survive the page. */
    flushWithKeepalive(): void {
        this.writes.flushWithKeepalive();
    }

    /**
     * Before a playlist (or every playlist) is deleted on the server: drop
     * its queued and early edits and its cache, and let writes already
     * travelling land first, so none recreates deleted data afterwards.
     */
    async discard(playlistId?: string): Promise<void> {
        const matches = (key: string) =>
            playlistId === undefined || splitEditKey(key)[1] === playlistId;
        for (const key of [...this.deferred.keys()]) {
            if (matches(key)) {
                this.deferred.delete(key);
            }
        }
        saveDeferredEdits(this.tabStore, this.instanceId, [
            ...this.deferred.values(),
        ]);
        await this.writes.discard(matches, playlistId);
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const map = this.baseline(namespace);
            if (playlistId === undefined) {
                this.writeCache(namespace, null);
            } else if (playlistId in map) {
                delete map[playlistId];
                this.writeCache(namespace, JSON.stringify(map));
            }
        }
    }

    private async hydrateNow(): Promise<void> {
        // Edits from here on may miss the read: queued, or still travelling.
        const editsBefore = this.writes.lastEdit;
        await this.writes.flush();
        const { entries, tags } =
            await this.api.getJson<ServerUserStateResponse>('/user-state');
        const unsaved = this.writes.unsavedSince(editsBefore);
        // Another tab's unconfirmed writes are in the shared cache too.
        for (const key of othersUnconfirmed(
            this.local,
            this.instanceId,
            this.tabId
        )) {
            unsaved.add(key);
        }
        const deferred = [...this.deferred.values()];
        const refreshed = new Map<string, Record<string, unknown>>();
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const keepCached = new Set<string>();
            for (const key of unsaved) {
                const [editedNamespace, playlistId] = splitEditKey(key);
                if (editedNamespace === namespace) {
                    keepCached.add(playlistId);
                }
            }
            const value = refreshedNamespace(
                entries[namespace] ?? {},
                this.baseline(namespace),
                keepCached,
                deferred.filter((edit) => edit.namespace === namespace)
            );
            refreshed.set(namespace, value);
            // A value too big for browser storage stays readable in memory,
            // so callers and the diff baseline see the same map.
            this.writeCache(namespace, JSON.stringify(value));
            if (tags) {
                this.writes.setTags(namespace, tags[namespace] ?? {});
            }
        }
        this.writes.settledUpTo(editsBefore);
        if (!this.hydrated) {
            // From here edits go straight to the queue.
            this.hydrated = true;
            this.deferred.clear();
            for (const edit of deferred) {
                this.writes.queue(
                    edit.namespace,
                    edit.playlistId,
                    refreshed.get(edit.namespace)?.[edit.playlistId],
                    entries[edit.namespace]?.[edit.playlistId]
                );
            }
            saveDeferredEdits(this.tabStore, this.instanceId, []);
            this.writes.scheduleFlush();
        }
    }

    private readCache(namespace: ServerUserStateNamespace): string | null {
        return (
            this.overflow.get(namespace) ??
            this.local.getItem(SERVER_CACHE_PREFIX + namespace)
        );
    }

    /** `null` empties the entry. Browser storage first, memory if full. */
    private writeCache(
        namespace: ServerUserStateNamespace,
        value: string | null
    ): void {
        try {
            if (value === null) {
                this.local.removeItem(SERVER_CACHE_PREFIX + namespace);
            } else {
                this.local.setItem(SERVER_CACHE_PREFIX + namespace, value);
            }
            this.overflow.delete(namespace);
        } catch {
            this.overflow.set(namespace, value ?? '{}');
        }
    }

    /** A conflict replay settled what the entry holds. */
    private showEntry(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown
    ): void {
        const map = this.baseline(namespace);
        if (value === undefined) {
            delete map[playlistId];
        } else {
            map[playlistId] = value;
        }
        this.writeCache(namespace, JSON.stringify(map));
    }

    private isSynced(key: string): key is ServerUserStateNamespace {
        return isServerUserStateNamespace(key);
    }

    /**
     * What a write is compared against: the map the caller read, so an edit
     * sends only its own entries, never another tab's changes in the shared
     * cache.
     */
    private baseline(
        namespace: ServerUserStateNamespace
    ): Record<string, unknown> {
        return parseMap(this.readCache(namespace) ?? '{}');
    }

    private queueChanges(
        namespace: ServerUserStateNamespace,
        next: Record<string, unknown>,
        previous: Record<string, unknown>
    ): void {
        const change = (playlistId: string, value: unknown) => {
            if (this.hydrated) {
                this.writes.queue(
                    namespace,
                    playlistId,
                    value,
                    previous[playlistId]
                );
                return;
            }
            const key = `${namespace}|${playlistId}`;
            const earlier = this.deferred.get(key);
            this.deferred.set(key, {
                namespace,
                playlistId,
                // An earlier edit's baseline stays, even when it was empty.
                before: earlier ? earlier.before : previous[playlistId],
                after: value,
            });
            saveDeferredEdits(this.tabStore, this.instanceId, [
                ...this.deferred.values(),
            ]);
            this.publishUnconfirmed();
        };
        for (const [playlistId, value] of Object.entries(next)) {
            if (
                JSON.stringify(previous[playlistId]) !== JSON.stringify(value)
            ) {
                change(playlistId, value);
            }
        }
        for (const playlistId of Object.keys(previous)) {
            if (!(playlistId in next)) {
                change(playlistId, undefined);
            }
        }
        this.writes.scheduleFlush();
    }

    /** Persists what the server has not confirmed; skips idle rewrites. */
    private saveUnsent(): void {
        // A newer edit can be queued while an older one is still travelling.
        const writes = this.writes.unsentWrites();
        if (writes.length === 0 && !this.unsentSaved) {
            return;
        }
        saveUnsentWrites(this.tabStore, this.instanceId, writes);
        this.unsentSaved = writes.length > 0;
        this.publishUnconfirmed();
    }

    private publishUnconfirmed(): void {
        markUnconfirmed(this.local, this.instanceId, this.tabId, [
            ...this.writes.unconfirmedKeys(),
            ...this.deferred.keys(),
        ]);
    }
}
