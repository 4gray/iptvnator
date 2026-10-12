import {
    isServerUserStateNamespace,
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';
import type { ServerApiClient } from './server-api-client';
import {
    addStep,
    parseMap,
    splitEditKey,
    UNKNOWN_TAG,
} from './server-user-data-entries';
import {
    type DeferredEdit,
    refreshedNamespace,
    replaySteps,
} from './server-user-data-edit';
import { UserDataWriteQueue } from './server-user-data-queue';
import {
    claimCache,
    markUnconfirmed,
    orphanedPages,
    othersUnconfirmed,
    readDeferredEdits,
    readUnsentWrites,
    removePage,
    saveDeferredEdits,
    saveUnsentWrites,
    swapPage,
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
     * Edits made before the first successful read: the cache they were
     * made against may be empty or old, so they are replayed on the
     * server's value once it is known (`applyEdit`).
     */
    private readonly deferred = new Map<string, DeferredEdit>();
    private hydrated = false;
    /** This page load: names its saved writes and its registry record. */
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
         * The tab's own storage (`sessionStorage` in the app): remembers
         * its page load, so a reload takes over the writes it saved.
         */
        tabStore: UserDataStorage = local
    ) {
        this.writes = new UserDataWriteQueue(api, {
            changed: () => this.saveUnsent(),
            show: (namespace, playlistId, value) =>
                this.showEntry(namespace, playlistId, value),
            writeFailed: onWriteFailure,
        });
        claimCache(local, instanceId);
        const previous = swapPage(tabStore, instanceId, this.tabId);
        if (previous) {
            this.takeOver(previous);
        }
    }

    /**
     * A reload of this tab: the writes its last page load could not confirm
     * go out with the first flush, and the first read keeps them.
     */
    private takeOver(page: string): void {
        for (const write of readUnsentWrites(
            this.local,
            this.instanceId,
            page
        )) {
            this.writes.queue(
                write.namespace,
                write.playlistId,
                write.value,
                undefined,
                { tag: write.tag, steps: write.steps }
            );
        }
        for (const edit of readDeferredEdits(
            this.local,
            this.instanceId,
            page
        )) {
            this.deferred.set(`${edit.namespace}|${edit.playlistId}`, edit);
        }
        // Saved under this page load before the old one is forgotten.
        this.saveDeferred();
        this.saveUnsent();
        this.publishUnconfirmed();
        removePage(this.local, this.instanceId, page);
    }

    /**
     * Saved writes and early edits of closed tabs: shown on what this tab
     * shows now and queued with its writes, then forgotten there.
     */
    private adoptClosedTabs(): void {
        for (const page of orphanedPages(
            this.local,
            this.instanceId,
            this.tabId
        )) {
            const edits = [
                ...readDeferredEdits(this.local, this.instanceId, page),
                ...readUnsentWrites(this.local, this.instanceId, page),
            ];
            const foreign = othersUnconfirmed(
                this.local,
                this.instanceId,
                this.tabId
            );
            for (const { namespace, playlistId, steps } of edits) {
                const value = replaySteps(
                    this.baseline(namespace)[playlistId],
                    steps
                );
                this.showEntry(namespace, playlistId, value);
                // Queued even when the cache shows it already.
                this.writes.adopt(
                    namespace,
                    playlistId,
                    value,
                    steps,
                    foreign.has(`${namespace}|${playlistId}`)
                );
            }
            // Saved here before the closed tab's copy is forgotten.
            this.writes.scheduleFlush();
            removePage(this.local, this.instanceId, page);
        }
    }

    /** Tells other tabs this one is alive and still sending its writes. */
    touch(): void {
        if (this.hasUnsentWrites()) {
            this.publishUnconfirmed();
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
     * Runs the server delete of a playlist (without an id, of every
     * playlist). Its user-data edits wait meanwhile and writes already
     * travelling land first, so none recreates deleted data; a delete that
     * succeeded drops its queued and early edits and its cache, a failed
     * one leaves them to be sent as before.
     */
    async deleting(
        playlistId: string | undefined,
        remove: () => Promise<unknown>
    ): Promise<void> {
        const matches = (key: string) =>
            playlistId === undefined || splitEditKey(key)[1] === playlistId;
        const release = this.writes.hold(matches);
        try {
            await this.writes.whenSent();
            await remove();
            this.forget(matches, playlistId);
        } finally {
            release();
        }
    }

    private forget(
        matches: (key: string) => boolean,
        playlistId: string | undefined
    ): void {
        for (const key of [...this.deferred.keys()]) {
            if (matches(key)) {
                this.deferred.delete(key);
            }
        }
        this.saveDeferred();
        this.writes.drop(matches, playlistId);
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
                // A kept value is not what the server's tag describes: its
                // next write must conflict and be replayed on the server's.
                const fresh = { ...tags[namespace] };
                for (const playlistId of keepCached) {
                    fresh[playlistId] = UNKNOWN_TAG;
                }
                this.writes.setTags(namespace, fresh);
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
            this.saveDeferred();
            this.writes.scheduleFlush();
        }
        this.adoptClosedTabs();
    }

    /** Memory first; browser storage that refuses access reads as empty. */
    private readCache(namespace: ServerUserStateNamespace): string | null {
        const kept = this.overflow.get(namespace);
        if (kept !== undefined) {
            return kept;
        }
        try {
            return this.local.getItem(SERVER_CACHE_PREFIX + namespace);
        } catch {
            return null;
        }
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
        // The cache shows other tabs' unsent changes too.
        const foreign = this.hydrated
            ? othersUnconfirmed(this.local, this.instanceId, this.tabId)
            : new Set<string>();
        const change = (playlistId: string, value: unknown) => {
            if (this.hydrated) {
                this.writes.queue(
                    namespace,
                    playlistId,
                    value,
                    previous[playlistId],
                    { foreign: foreign.has(`${namespace}|${playlistId}`) }
                );
                return;
            }
            const key = `${namespace}|${playlistId}`;
            this.deferred.set(key, {
                namespace,
                playlistId,
                steps: addStep(
                    this.deferred.get(key)?.steps ?? [],
                    previous[playlistId],
                    value
                ),
            });
            this.saveDeferred();
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
        saveUnsentWrites(this.local, this.instanceId, this.tabId, writes);
        this.unsentSaved = writes.length > 0;
        this.publishUnconfirmed();
    }

    private saveDeferred(): void {
        saveDeferredEdits(this.local, this.instanceId, this.tabId, [
            ...this.deferred.values(),
        ]);
    }

    private publishUnconfirmed(): void {
        markUnconfirmed(this.local, this.instanceId, this.tabId, [
            ...this.writes.unconfirmedKeys(),
            ...this.deferred.keys(),
        ]);
    }
}
