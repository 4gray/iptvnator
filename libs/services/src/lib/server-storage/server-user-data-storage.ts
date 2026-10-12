import {
    isServerUserStateNamespace,
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';
import type { ServerApiClient } from './server-api-client';
import {
    entryKey,
    entryPath,
    parseMap,
    type PendingEntry,
    splitEditKey,
} from './server-user-data-entries';
import { type DeferredEdit, refreshedNamespace } from './server-user-data-edit';
import {
    claimCache,
    markUnconfirmed,
    newestWrites,
    othersUnconfirmed,
    readDeferredEdits,
    readUnsentWrites,
    saveDeferredEdits,
    saveUnsentWrites,
} from './server-unsent-writes';

/** Server-mode cache keys; the legacy unprefixed keys are never touched. */
export const SERVER_CACHE_PREFIX = 'iptvnator-server:';
const FLUSH_DELAY_MS = 500;

type ServerApi = Pick<
    ServerApiClient,
    'getJson' | 'sendJson' | 'request' | 'sendKeepalive'
>;

/**
 * Write-through `USER_DATA_STORAGE` for server mode. Synced namespaces are
 * maps keyed by playlist id; a write compares the new map with the last one
 * the server saw and sends only the playlist entries that changed. Other
 * keys use plain storage.
 */
export class ServerUserDataStorage implements UserDataStorage {
    private readonly synced = new Map<
        ServerUserStateNamespace,
        Record<string, unknown>
    >();
    private readonly pending = new Map<string, PendingEntry>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    /** Batches go out one at a time, so an older write never lands last. */
    private sending: Promise<void> = Promise.resolve();
    private writesInFlight = 0;
    /** Writes still travelling (normal or page-hide), by entry key. */
    private readonly inFlight = new Map<string, PendingEntry>();
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
    /** Edit counter per `namespace|playlistId`, for hydrate to keep them. */
    private readonly edits = new Map<string, number>();
    private editCount = 0;

    constructor(
        private readonly api: ServerApi,
        private readonly local: UserDataStorage,
        private readonly onWriteFailure: (error: unknown) => void,
        /** Scopes the cache and saved writes to one server database. */
        private readonly instanceId = 'default',
        /**
         * Where this tab keeps what the server has not confirmed: its own
         * (`sessionStorage` in the app), so tabs never clear each other's,
         * and a reload of the tab finds it again.
         */
        private readonly tabStore: UserDataStorage = local
    ) {
        claimCache(local, instanceId);
        // Writes a previous visit could not confirm go out with the first
        // flush, and the first read keeps them.
        for (const write of readUnsentWrites(tabStore, instanceId)) {
            this.queue(write.namespace, write.playlistId, write.value);
        }
        this.unsentSaved = this.pending.size > 0;
        for (const edit of readDeferredEdits(tabStore, instanceId)) {
            this.deferred.set(`${edit.namespace}|${edit.playlistId}`, edit);
        }
    }

    /** Whether a write is queued, being retried, or still travelling. */
    hasUnsentWrites(): boolean {
        return (
            this.pending.size > 0 ||
            this.inFlight.size > 0 ||
            this.deferred.size > 0
        );
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

    private async hydrateNow(): Promise<void> {
        // Edits from here on may miss the read: queued, or still travelling.
        const editsBefore = this.editCount;
        await this.flush();
        const { entries } =
            await this.api.getJson<ServerUserStateResponse>('/user-state');
        const unsaved = new Set([
            ...this.pending.keys(),
            ...this.inFlight.keys(),
        ]);
        for (const [key, edit] of this.edits) {
            if (edit > editsBefore) {
                unsaved.add(key);
            }
        }
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
                parseMap(this.readCache(namespace) ?? '{}'),
                keepCached,
                deferred.filter((edit) => edit.namespace === namespace)
            );
            refreshed.set(namespace, value);
            // A value too big for browser storage stays readable in memory,
            // so callers and the diff baseline see the same map.
            this.writeCache(namespace, JSON.stringify(value));
            this.synced.set(namespace, value);
        }
        for (const [key, edit] of this.edits) {
            if (
                edit <= editsBefore &&
                !this.pending.has(key) &&
                !this.inFlight.has(key)
            ) {
                this.edits.delete(key);
            }
        }
        if (!this.hydrated) {
            // From here edits go straight to the queue.
            this.hydrated = true;
            this.deferred.clear();
            for (const edit of deferred) {
                this.queue(
                    edit.namespace,
                    edit.playlistId,
                    refreshed.get(edit.namespace)?.[edit.playlistId]
                );
            }
            saveDeferredEdits(this.tabStore, this.instanceId, []);
            this.scheduleFlush();
        }
    }

    /** Sends the queued entries after any batch still travelling. */
    flush(): Promise<void> {
        const run = this.sending.then(async () => {
            const batch = this.takePending();
            if (batch.length === 0) {
                return;
            }
            for (const entry of batch) {
                this.inFlight.set(entryKey(entry), entry);
            }
            this.writesInFlight += 1;
            try {
                await Promise.all(batch.map((entry) => this.send(entry)));
            } finally {
                this.writesInFlight -= 1;
            }
        });
        this.sending = run.then(
            () => undefined,
            () => undefined
        );
        return this.sending;
    }

    /**
     * Page hide: `keepalive` requests survive the page. They go out at once
     * unless a write is still travelling, which they must not overtake, and
     * later writes wait for them in turn.
     */
    flushWithKeepalive(): void {
        const entries = this.takePending();
        if (entries.length === 0) {
            // Writes still travelling may be cut off with the page.
            this.saveUnsent();
            return;
        }
        const sendAll = async (): Promise<void> => {
            this.writesInFlight += 1;
            try {
                await Promise.all(
                    entries.map((entry) => this.sendKeepalive(entry))
                );
            } finally {
                this.writesInFlight -= 1;
            }
        };
        for (const entry of entries) {
            this.inFlight.set(entryKey(entry), entry);
        }
        this.saveUnsent();
        // Idle: send synchronously, while the hiding page still runs.
        const run =
            this.writesInFlight === 0 ? sendAll() : this.sending.then(sendAll);
        this.sending = run.then(
            () => undefined,
            () => undefined
        );
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

    private isSynced(key: string): key is ServerUserStateNamespace {
        return isServerUserStateNamespace(key);
    }

    /**
     * What a write is compared against: the server's last value, or before
     * the first read finishes, the cache, so an edit sends only its entry.
     */
    private baseline(
        namespace: ServerUserStateNamespace
    ): Record<string, unknown> {
        return (
            this.synced.get(namespace) ??
            parseMap(this.readCache(namespace) ?? '{}')
        );
    }

    private queueChanges(
        namespace: ServerUserStateNamespace,
        next: Record<string, unknown>,
        previous: Record<string, unknown>
    ): void {
        const change = (playlistId: string, value: unknown) => {
            if (this.hydrated) {
                this.queue(namespace, playlistId, value);
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
        this.synced.set(namespace, next);
        this.scheduleFlush();
    }

    private queue(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown
    ): void {
        const entry: PendingEntry = {
            namespace,
            playlistId,
            value,
            edit: ++this.editCount,
        };
        this.pending.set(entryKey(entry), entry);
        this.edits.set(entryKey(entry), entry.edit);
    }

    private scheduleFlush(): void {
        if (this.pending.size === 0) {
            return;
        }
        // Saved at once: another tab's re-read must not replace them.
        this.saveUnsent();
        if (this.flushTimer !== null) {
            return;
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
        }, FLUSH_DELAY_MS);
    }

    private takePending(): PendingEntry[] {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        const batch = [...this.pending.values()];
        this.pending.clear();
        return batch;
    }

    /**
     * Back into the queue after a failed write, for the offline retry or
     * the next edit, unless the entry was edited since it was sent.
     */
    private requeue(entry: PendingEntry): void {
        const key = entryKey(entry);
        if (this.edits.get(key) === entry.edit && !this.pending.has(key)) {
            this.pending.set(key, entry);
        }
    }

    private async sendKeepalive(entry: PendingEntry): Promise<void> {
        const path = entryPath(entry);
        const ok = await (entry.value === undefined
            ? this.api.sendKeepalive('DELETE', path)
            : this.api.sendKeepalive('PUT', path, { value: entry.value }));
        this.retireInFlight(entry);
        if (!ok) {
            this.requeue(entry);
        }
        this.saveUnsent();
    }

    private async send(entry: PendingEntry): Promise<void> {
        try {
            if (entry.value === undefined) {
                await this.api.request(entryPath(entry), { method: 'DELETE' });
            } else {
                await this.api.sendJson('PUT', entryPath(entry), {
                    value: entry.value,
                });
            }
            this.retireInFlight(entry);
            this.saveUnsent();
        } catch (error) {
            this.retireInFlight(entry);
            this.requeue(entry);
            this.saveUnsent();
            this.onWriteFailure(error);
        }
    }

    /** A newer write of the same entry may have replaced it meanwhile. */
    private retireInFlight(entry: PendingEntry): void {
        const key = entryKey(entry);
        if (this.inFlight.get(key)?.edit === entry.edit) {
            this.inFlight.delete(key);
        }
    }

    /** Persists what the server has not confirmed; skips idle rewrites. */
    private saveUnsent(): void {
        // A newer edit can be queued while an older one is still travelling.
        const writes = newestWrites([
            ...this.inFlight.values(),
            ...this.pending.values(),
        ]);
        if (writes.length === 0 && !this.unsentSaved) {
            return;
        }
        saveUnsentWrites(this.tabStore, this.instanceId, writes);
        this.unsentSaved = writes.length > 0;
        this.publishUnconfirmed();
    }

    private publishUnconfirmed(): void {
        markUnconfirmed(this.local, this.instanceId, this.tabId, [
            ...this.pending.keys(),
            ...this.inFlight.keys(),
            ...this.deferred.keys(),
        ]);
    }
}
