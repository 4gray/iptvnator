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
    idMap,
    parseMap,
    splitEditKey,
    UNKNOWN_TAG,
} from './server-user-data-entries';
import {
    adoptPageEdits,
    extendUnsent,
    restorePage,
    settleWrites,
} from './server-user-data-adopt';
import { keepPages, swapPage } from './server-page-pointer';
import { UserDataCache } from './server-user-data-cache';
import {
    changedEntries,
    type DeferredEdit,
    mergeEdits,
    refreshedNamespace,
    withoutDeleted,
} from './server-user-data-edit';
import { type ServerApi, UserDataWriteQueue } from './server-user-data-queue';
import {
    claimCache,
    hasRecord,
    markClosed,
    markUnconfirmed,
    orphanedPages,
    pageIsLive,
    othersUnconfirmed,
    removePage,
    saveDeferredEdits,
    saveUnsentWrites,
} from './server-unsent-writes';

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
    /** The previous page load in this tab, while it still looks live. */
    private awaited: string | null = null;
    /** A record stands for this page: a stale one is adopted elsewhere. */
    private recorded = false;
    /** Playlists deleted here, in order: a read sent earlier skips them. */
    private readonly deleted: (string | undefined)[] = [];
    /** Closed tabs' page loads this one took over (once each). */
    private readonly adopted = new Set<string>();
    /** Page loads taken over whose copy stays until this one saves. */
    private readonly retained = new Set<string>();
    /** This page load: names its saved writes and its registry record. */
    private readonly tabId = Math.random().toString(36).slice(2);
    private readonly cache: UserDataCache;
    /**
     * What `getItem` last handed out (or a write left) per namespace: the
     * map a caller edits, so its write is compared with that, not with
     * changes another tab or a re-read made to the cache since.
     */
    private readonly handedOut = new Map<
        ServerUserStateNamespace,
        string | null
    >();
    /** Re-reads run one at a time, so an older one never lands last. */
    private hydration: Promise<void> = Promise.resolve();

    constructor(
        private readonly api: ServerApi & Pick<ServerApiClient, 'getJson'>,
        private readonly local: UserDataStorage,
        onWriteFailure: (error: unknown) => void,
        /** Scopes the cache and saved writes to one server database. */
        private readonly instanceId = 'default',
        /**
         * The tab's own storage (`sessionStorage` in the app): remembers
         * its page load, so a reload takes over the writes it saved.
         */
        private readonly tabStore: UserDataStorage = local
    ) {
        this.cache = new UserDataCache(local, instanceId);
        this.writes = new UserDataWriteQueue(api, {
            changed: () => this.saveUnsent(),
            show: (namespace, playlistId, value) =>
                this.cache.setEntry(namespace, playlistId, value),
            writeFailed: onWriteFailure,
            maySend: () => !this.superseded(),
        });
        claimCache(local, instanceId);
        const [previous, ...kept] = swapPage(tabStore, instanceId, this.tabId);
        // Older page loads whose copies a reload kept come first.
        kept.forEach((page) => this.takeOver(page));
        // A duplicated tab copies the page load of a tab that still runs;
        // so does a reload whose close flag could not be saved: `touch`
        // adopts it once it no longer looks live.
        if (previous && pageIsLive(local, instanceId, previous)) {
            this.awaited = previous;
        } else if (previous) {
            this.takeOver(previous);
        }
    }

    /** The page unloads: a reload of this tab may take its writes over. */
    close(): void {
        markClosed(this.local, this.instanceId, this.tabId);
    }

    /**
     * A reload of this tab: the writes its last page load could not confirm
     * go out with the first flush, and the first read keeps them.
     */
    private takeOver(page: string): void {
        restorePage(
            this.writes,
            this.deferred,
            this.local,
            this.instanceId,
            page
        );
        // Saved under this page load before the old one is forgotten; if
        // storage refuses the copy, the old one stays.
        const saved = [this.saveDeferred(), this.saveUnsent()].every(Boolean);
        this.publishUnconfirmed();
        this.release(page, saved);
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
        ).filter((page) => !this.adopted.has(page))) {
            this.adoptPage(page);
        }
    }

    /** Its edits go ahead of this tab's own, which may be newer. */
    private adoptPage(page: string): void {
        adoptPageEdits(this.writes, this.cache, {
            local: this.local,
            instanceId: this.instanceId,
            tabId: this.tabId,
            page,
        });
        this.adopted.add(page);
        // The other page's copy goes only once this tab saved its own.
        this.release(page, this.saveUnsent());
        this.writes.scheduleFlush();
    }

    /** Tells other tabs this one is alive and still sending its writes. */
    touch(): void {
        const page = this.awaited;
        if (page && !pageIsLive(this.local, this.instanceId, page)) {
            // This page may have read and edited since: adopt, not restore.
            this.awaited = null;
            this.adoptPage(page);
        }
        // A tab with nothing to sync never re-reads, which is where closed
        // tabs' saved writes are otherwise picked up.
        if (this.hydrated) {
            this.adoptClosedTabs();
        }
        if (this.hasUnsentWrites()) {
            this.publishUnconfirmed();
        }
    }

    /**
     * Back from the back-forward cache or a suspended background tab, where
     * its record could go stale: false when another tab took its writes
     * over meanwhile, which this page must then not send again (it reloads
     * instead).
     */
    resumed(): boolean {
        this.publishUnconfirmed();
        return !this.superseded();
    }

    /**
     * Its record is gone: another tab took this page's writes over, so
     * nothing more of them goes out or is saved here.
     */
    private superseded(): boolean {
        return (
            this.recorded && !hasRecord(this.local, this.instanceId, this.tabId)
        );
    }

    /** Not read yet, or holding writes the server has not taken. */
    needsSync(): boolean {
        return !this.hydrated || this.hasUnsentWrites();
    }

    /**
     * Once a first read in flight settled: whether reads show the server's
     * data. Starts no read, so an offline page is not held up; `fresh`
     * (backups) reads the server again and tells whether that succeeded.
     */
    async ready(fresh = false): Promise<boolean> {
        if (fresh) {
            return this.hydrate().then(
                () => true,
                () => false
            );
        }
        await (this.hydrated ? undefined : this.hydration);
        return this.hydrated;
    }

    /** Whether a write is queued, being retried, or still travelling. */
    hasUnsentWrites(): boolean {
        return this.writes.hasUnsent() || this.deferred.size > 0;
    }

    getItem(key: string): string | null {
        if (!isServerUserStateNamespace(key)) {
            return this.local.getItem(key);
        }
        const value = this.cache.read(key);
        this.handedOut.set(key, value);
        return value;
    }

    setItem(key: string, value: string): void {
        this.write(key, value);
    }

    removeItem(key: string): void {
        this.write(key, null);
    }

    /**
     * A caller's new map. When the cache changed since the caller read it
     * (another tab, a re-read), only the entries it changed are applied to
     * the cache as it is now; the rest stays. Other keys use plain storage.
     */
    private write(namespace: string, value: string | null): void {
        if (!isServerUserStateNamespace(namespace)) {
            if (value === null) {
                this.local.removeItem(namespace);
            } else {
                this.local.setItem(namespace, value);
            }
            return;
        }
        const current = this.cache.read(namespace);
        const before = parseMap(current ?? '{}');
        const read = this.handedOut.has(namespace)
            ? (this.handedOut.get(namespace) ?? null)
            : current;
        let next = parseMap(value ?? '{}');
        if (read !== current) {
            next = mergeEdits(before, parseMap(read ?? '{}'), next);
            value = JSON.stringify(next);
        }
        this.cache.write(namespace, value);
        this.handedOut.set(namespace, value);
        this.queueChanges(namespace, next, before);
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
    readonly flush = (): Promise<void> => this.writes.flush();

    /** See `UserDataStorage.flushed`. */
    readonly flushed = (playlistId?: string) =>
        settleWrites(this.writes, playlistId);

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
            this.deleted.push(playlistId);
            for (const key of [...this.deferred.keys()].filter(matches)) {
                this.deferred.delete(key);
            }
            this.saveDeferred();
            this.writes.drop(matches, playlistId);
            this.cache.forget(playlistId);
        } finally {
            release();
        }
    }

    private async hydrateNow(): Promise<void> {
        // Edits from here on may miss the read: queued, or still travelling.
        const editsBefore = this.writes.lastEdit;
        const deletesBefore = this.deleted.length;
        await this.writes.flush();
        const sent = this.cache.snapshot();
        const foreign = () =>
            othersUnconfirmed(this.local, this.instanceId, this.tabId);
        const foreignBefore = foreign();
        const { entries, tags } = withoutDeleted(
            await this.api.getJson<ServerUserStateResponse>('/user-state'),
            this.deleted.slice(deletesBefore)
        );
        const unsaved = this.writes.unsavedSince(editsBefore);
        // In the shared cache: other tabs' writes unconfirmed when this read
        // went out or now (one confirmed meanwhile is newer than its answer),
        // and what a tab saved while it travelled.
        for (const key of [
            ...foreignBefore,
            ...foreign(),
            ...this.cache.changedSince(sent),
        ]) {
            unsaved.add(key);
        }
        const deferred = [...this.deferred.values()];
        // This tab's own unsent writes (recovered after a reload): an early
        // edit was made on them, not on the server's value.
        const own = new Set(this.writes.unconfirmedKeys());
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
            const cached = this.cache.map(namespace);
            const early = deferred.filter(
                (edit) => edit.namespace === namespace
            );
            for (const { playlistId } of early) {
                const key = `${namespace}|${playlistId}`;
                base.set(
                    key,
                    own.has(key)
                        ? this.writes.unsent(key)?.value
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
            this.cache.write(namespace, JSON.stringify(value));
            if (tags) {
                // A kept value is not what the server's tag describes: its
                // next write must conflict and be replayed on the server's.
                const fresh = idMap(tags[namespace]);
                for (const playlistId of keepCached) {
                    fresh[playlistId] = UNKNOWN_TAG;
                }
                this.writes.tags.set(namespace, fresh);
            }
        }
        this.writes.settledUpTo(editsBefore);
        if (!this.hydrated) {
            // From here edits go straight to the queue.
            this.hydrated = true;
            this.deferred.clear();
            for (const edit of deferred) {
                const key = `${edit.namespace}|${edit.playlistId}`;
                if (own.has(key)) {
                    extendUnsent(this.writes, key, edit.steps);
                } else {
                    this.writes.queue(
                        edit.namespace,
                        edit.playlistId,
                        refreshed.get(edit.namespace)?.[edit.playlistId],
                        base.get(key)
                    );
                }
            }
            this.saveDeferred();
            this.writes.scheduleFlush();
        }
        this.adoptClosedTabs();
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
        for (const [playlistId, value] of changedEntries(previous, next)) {
            change(playlistId, value);
        }
        this.writes.scheduleFlush();
    }

    /** Persists what the server has not confirmed; skips idle rewrites. */
    /** False when browser storage refused the copy. */
    private saveUnsent(): boolean {
        if (this.superseded()) {
            return false;
        }
        // A newer edit can be queued while an older one is still travelling.
        const writes = this.writes.unsentWrites();
        if (writes.length === 0 && !this.unsentSaved) {
            return true;
        }
        const saved = saveUnsentWrites(
            this.local,
            this.instanceId,
            this.tabId,
            writes
        );
        this.unsentSaved = writes.length > 0 || !saved;
        this.publishUnconfirmed();
        if (saved && this.retained.size > 0 && this.saveDeferred()) {
            // This page's copy now stands for the ones it kept.
            for (const page of this.retained) {
                removePage(this.local, this.instanceId, page);
            }
            this.retained.clear();
            keepPages(this.tabStore, this.instanceId, this.tabId, []);
        }
        return saved;
    }

    /** Forgets another page load's copy, or keeps it until this one saves. */
    private release(page: string, saved: boolean): void {
        if (saved) {
            removePage(this.local, this.instanceId, page);
        } else {
            this.retained.add(page);
            keepPages(this.tabStore, this.instanceId, this.tabId, [
                ...this.retained,
            ]);
        }
    }

    private saveDeferred(): boolean {
        return saveDeferredEdits(this.local, this.instanceId, this.tabId, [
            ...this.deferred.values(),
        ]);
    }

    private publishUnconfirmed(): void {
        // Superseded, it stays so: the record is not written again.
        this.recorded =
            this.superseded() ||
            markUnconfirmed(this.local, this.instanceId, this.tabId, [
                ...this.writes.unconfirmedKeys(),
                ...this.deferred.keys(),
            ]);
    }
}
