import {
    isServerUserStateNamespace,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';
import type { ServerApiClient } from './server-api-client';
import { addStep, parseMap, splitEditKey } from './server-user-data-entries';
import {
    adoptPageEdits,
    restorePage,
    settleWrites,
} from './server-user-data-adopt';
import { swapPage } from './server-page-pointer';
import { UserDataCache } from './server-user-data-cache';
import {
    changedEntries,
    type DeferredEdit,
    mergeEdits,
    withoutDeleted,
} from './server-user-data-edit';
import { applyServerRead, queueEarlyEdits } from './server-user-data-hydrate';
import { PageJournal } from './server-user-data-journal';
import { UserDataWriteQueue } from './server-user-data-queue';
import type { ServerApi } from './server-user-data-send';
import { claimCache } from './server-unsent-writes';

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
    /** This page load's copy of what the server has not confirmed. */
    private readonly journal: PageJournal;
    /**
     * Edits made before the first successful read: the cache they were
     * made against may be empty or old, so they are replayed on the
     * server's value once it is known (`applyEdit`).
     */
    private readonly deferred = new Map<string, DeferredEdit>();
    private hydrated = false;
    /** The previous page load in this tab, while it still looks live. */
    private awaited: string[] = [];
    /** Playlists deleted here, in order: a read sent earlier skips them. */
    private readonly deleted: (string | undefined)[] = [];
    /** Closed tabs' page loads this one took over (once each). */
    private readonly adopted = new Set<string>();
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
        tabStore: UserDataStorage = local
    ) {
        this.cache = new UserDataCache(local, instanceId);
        this.writes = new UserDataWriteQueue(api, {
            changed: () => this.journal.saveUnsent(),
            show: (namespace, playlistId, value) =>
                this.cache.setEntry(namespace, playlistId, value),
            writeFailed: onWriteFailure,
            maySend: () => !this.journal.superseded(),
        });
        this.journal = new PageJournal(
            local,
            instanceId,
            this.tabId,
            tabStore,
            this.writes,
            this.deferred
        );
        claimCache(local, instanceId);
        const [previous, ...kept] = swapPage(tabStore, instanceId, this.tabId);
        // Older page loads whose copies a reload kept come first.
        const pages = previous ? [...kept, previous] : kept;
        // A duplicated tab copies the page load of a tab that still runs,
        // and the ones it keeps; so does a reload whose close flag could not
        // be saved: `touch` adopts them once it no longer looks live.
        if (previous && this.journal.isLive(previous)) {
            this.awaited = pages;
        } else {
            pages.forEach((page) => this.takeOver(page));
        }
    }

    /** The page unloads: a reload of this tab may take its writes over. */
    close(): void {
        this.journal.close();
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
        const saved = [
            this.journal.saveDeferred(),
            this.journal.saveUnsent(),
        ].every(Boolean);
        this.journal.publishUnconfirmed();
        this.journal.release(page, saved);
    }

    /**
     * Saved writes and early edits of closed tabs: shown on what this tab
     * shows now and queued with its writes, then forgotten there.
     */
    private adoptClosedTabs(): void {
        for (const page of this.journal
            .orphans()
            .filter((page) => !this.adopted.has(page))) {
            this.adoptPages([page]);
        }
    }

    /**
     * Page loads, oldest first: their edits go ahead of this tab's own,
     * which may be newer. Each adopted page goes ahead of what is queued,
     * so they are adopted newest first.
     */
    private adoptPages(pages: readonly string[]): void {
        for (const page of [...pages].reverse()) {
            adoptPageEdits(this.writes, this.cache, {
                local: this.local,
                instanceId: this.instanceId,
                tabId: this.tabId,
                page,
            });
            this.adopted.add(page);
        }
        // Their copies go only once this tab saved its own; until then they
        // are kept oldest first, the order a reload restores them in.
        const saved = this.journal.saveUnsent();
        for (const page of pages) {
            this.journal.release(page, saved);
        }
        this.writes.scheduleFlush();
    }

    /** Tells other tabs this one is alive and still sending its writes. */
    touch(): void {
        const pages = this.awaited;
        const owner = pages[pages.length - 1];
        if (owner && !this.journal.isLive(owner)) {
            // This page may have read and edited since: adopt, not restore.
            this.awaited = [];
            this.adoptPages(pages);
        }
        // A tab with nothing to sync never re-reads, which is where closed
        // tabs' saved writes are otherwise picked up.
        if (this.hydrated) {
            this.adoptClosedTabs();
        }
        if (this.hasUnsentWrites()) {
            this.journal.publishUnconfirmed();
        }
    }

    /**
     * Back from the back-forward cache or a suspended background tab, where
     * its record could go stale: false when another tab took its writes
     * over meanwhile, which this page must then not send again (it reloads
     * instead).
     */
    resumed(): boolean {
        this.journal.publishUnconfirmed();
        return !this.journal.superseded();
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
            this.journal.saveDeferred();
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
        const foreignBefore = this.journal.unconfirmedElsewhere();
        const read = withoutDeleted(
            await this.api.getJson<ServerUserStateResponse>('/user-state'),
            this.deleted.slice(deletesBefore)
        );
        const unsaved = this.writes.unsavedSince(editsBefore);
        // In the shared cache: other tabs' writes unconfirmed when this read
        // went out or now (one confirmed meanwhile is newer than its answer),
        // and what a tab saved while it travelled.
        for (const key of [
            ...foreignBefore,
            ...this.journal.unconfirmedElsewhere(),
            ...this.cache.changedSince(sent),
        ]) {
            unsaved.add(key);
        }
        const applied = applyServerRead(
            this.writes,
            this.cache,
            this.deferred,
            read,
            unsaved
        );
        this.writes.settledUpTo(editsBefore);
        if (!this.hydrated) {
            // From here edits go straight to the queue.
            this.hydrated = true;
            this.deferred.clear();
            queueEarlyEdits(this.writes, applied);
            this.journal.saveDeferred();
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
            ? this.journal.unconfirmedElsewhere()
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
            this.journal.saveDeferred();
            this.journal.publishUnconfirmed();
        };
        for (const [playlistId, value] of changedEntries(previous, next)) {
            change(playlistId, value);
        }
        this.writes.scheduleFlush();
    }
}
