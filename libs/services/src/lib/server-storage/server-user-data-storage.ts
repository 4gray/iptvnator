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
import { readUnsentWrites, saveUnsentWrites } from './server-unsent-writes';

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
    /** Page-hide writes still travelling, by `namespace|playlistId`. */
    private readonly keepalive = new Map<string, PendingEntry>();
    private unsentSaved = false;
    /** Re-reads run one at a time, so an older one never lands last. */
    private hydration: Promise<void> = Promise.resolve();
    /** Edit counter per `namespace|playlistId`, for hydrate to keep them. */
    private readonly edits = new Map<string, number>();
    private editCount = 0;

    constructor(
        private readonly api: ServerApi,
        private readonly local: UserDataStorage,
        private readonly onWriteFailure: (error: unknown) => void
    ) {
        // Writes a previous visit could not confirm go out with the first
        // flush, and the first read keeps them.
        for (const write of readUnsentWrites(local)) {
            this.queue(write.namespace, write.playlistId, write.value);
        }
        this.unsentSaved = this.pending.size > 0;
    }

    /** Whether a write is queued, being retried, or still travelling. */
    hasUnsentWrites(): boolean {
        return this.pending.size > 0 || this.keepalive.size > 0;
    }

    getItem(key: string): string | null {
        return this.isSynced(key)
            ? this.local.getItem(SERVER_CACHE_PREFIX + key)
            : this.local.getItem(key);
    }

    setItem(key: string, value: string): void {
        if (!this.isSynced(key)) {
            this.local.setItem(key, value);
            return;
        }
        const before = this.baseline(key);
        this.local.setItem(SERVER_CACHE_PREFIX + key, value);
        this.queueChanges(key, parseMap(value), before);
    }

    removeItem(key: string): void {
        if (!this.isSynced(key)) {
            this.local.removeItem(key);
            return;
        }
        const before = this.baseline(key);
        this.local.removeItem(SERVER_CACHE_PREFIX + key);
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
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const value: Record<string, unknown> = {
                ...(entries[namespace] ?? {}),
            };
            const current = parseMap(
                this.local.getItem(SERVER_CACHE_PREFIX + namespace) ?? '{}'
            );
            const unsaved = new Set([
                ...this.pending.keys(),
                ...this.keepalive.keys(),
            ]);
            for (const [key, edit] of this.edits) {
                if (edit > editsBefore) {
                    unsaved.add(key);
                }
            }
            for (const key of unsaved) {
                const [editedNamespace, playlistId] = splitEditKey(key);
                if (editedNamespace !== namespace) {
                    continue;
                }
                if (playlistId in current) {
                    value[playlistId] = current[playlistId];
                } else {
                    delete value[playlistId];
                }
            }
            try {
                this.local.setItem(
                    SERVER_CACHE_PREFIX + namespace,
                    JSON.stringify(value)
                );
            } catch {
                // Storage full: keep the old cache and the baseline it was
                // diffed against together, or an edit would read as deletes.
                continue;
            }
            this.synced.set(namespace, value);
        }
        for (const [key, edit] of this.edits) {
            if (
                edit <= editsBefore &&
                !this.pending.has(key) &&
                !this.keepalive.has(key)
            ) {
                this.edits.delete(key);
            }
        }
    }

    /** Sends the queued entries after any batch still travelling. */
    flush(): Promise<void> {
        const run = this.sending.then(async () => {
            const batch = this.takePending();
            if (batch.length === 0) {
                return;
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
            this.keepalive.set(entryKey(entry), entry);
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
            parseMap(
                this.local.getItem(SERVER_CACHE_PREFIX + namespace) ?? '{}'
            )
        );
    }

    private queueChanges(
        namespace: ServerUserStateNamespace,
        next: Record<string, unknown>,
        previous: Record<string, unknown>
    ): void {
        for (const [playlistId, value] of Object.entries(next)) {
            if (
                JSON.stringify(previous[playlistId]) !== JSON.stringify(value)
            ) {
                this.queue(namespace, playlistId, value);
            }
        }
        for (const playlistId of Object.keys(previous)) {
            if (!(playlistId in next)) {
                this.queue(namespace, playlistId, undefined);
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
        if (this.flushTimer !== null || this.pending.size === 0) {
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
        this.keepalive.delete(entryKey(entry));
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
            this.saveUnsent();
        } catch (error) {
            this.requeue(entry);
            this.saveUnsent();
            this.onWriteFailure(error);
        }
    }

    /** Persists what the server has not confirmed; skips idle rewrites. */
    private saveUnsent(): void {
        const writes = [...this.pending.values(), ...this.keepalive.values()];
        if (writes.length === 0 && !this.unsentSaved) {
            return;
        }
        saveUnsentWrites(this.local, writes);
        this.unsentSaved = writes.length > 0;
    }
}
