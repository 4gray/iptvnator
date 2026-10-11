import {
    isServerUserStateNamespace,
    SERVER_USER_STATE_NAMESPACES,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import type { UserDataStorage } from '../user-data-storage';
import type { ServerApiClient } from './server-api-client';

/** Server-mode cache keys; the legacy unprefixed keys are never touched. */
export const SERVER_CACHE_PREFIX = 'iptvnator-server:';
const FLUSH_DELAY_MS = 500;

interface PendingEntry {
    readonly namespace: ServerUserStateNamespace;
    readonly playlistId: string;
    /** `undefined` deletes the entry. */
    readonly value: unknown;
}

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
    private batchesInFlight = 0;
    /** Page-hide writes still travelling, by `namespace|playlistId`. */
    private readonly keepaliveKeys = new Set<string>();
    /** Re-reads run one at a time, so an older one never lands last. */
    private hydration: Promise<void> = Promise.resolve();
    /** Edit counter per `namespace|playlistId`, for hydrate to keep them. */
    private readonly edits = new Map<string, number>();
    private editCount = 0;

    constructor(
        private readonly api: ServerApi,
        private readonly local: UserDataStorage,
        private readonly onWriteFailure: (error: unknown) => void
    ) {}

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
        this.local.setItem(SERVER_CACHE_PREFIX + key, value);
        this.queueChanges(key, parseMap(value));
    }

    removeItem(key: string): void {
        if (!this.isSynced(key)) {
            this.local.removeItem(key);
            return;
        }
        this.local.removeItem(SERVER_CACHE_PREFIX + key);
        this.queueChanges(key, {});
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
                ...this.keepaliveKeys,
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
            this.synced.set(namespace, value);
            this.local.setItem(
                SERVER_CACHE_PREFIX + namespace,
                JSON.stringify(value)
            );
        }
        for (const [key, edit] of this.edits) {
            if (
                edit <= editsBefore &&
                !this.pending.has(key) &&
                !this.keepaliveKeys.has(key)
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
            this.batchesInFlight += 1;
            try {
                await Promise.all(batch.map((entry) => this.send(entry)));
            } finally {
                this.batchesInFlight -= 1;
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
     * unless a batch is still travelling, which they must not overtake.
     */
    flushWithKeepalive(): void {
        const entries = this.takePending();
        if (entries.length === 0) {
            return;
        }
        const sendAll = () => {
            for (const entry of entries) {
                const key = entryKey(entry);
                const edit = this.edits.get(key);
                this.keepaliveKeys.add(key);
                const path = entryPath(entry);
                const sent =
                    entry.value === undefined
                        ? this.api.sendKeepalive('DELETE', path)
                        : this.api.sendKeepalive('PUT', path, {
                              value: entry.value,
                          });
                void sent.then((ok) => {
                    this.keepaliveKeys.delete(key);
                    if (!ok) {
                        this.requeue(entry, edit);
                    }
                });
            }
        };
        if (this.batchesInFlight === 0) {
            sendAll();
        } else {
            this.sending = this.sending.then(sendAll);
        }
    }

    private isSynced(key: string): key is ServerUserStateNamespace {
        return isServerUserStateNamespace(key);
    }

    private queueChanges(
        namespace: ServerUserStateNamespace,
        next: Record<string, unknown>
    ): void {
        const previous = this.synced.get(namespace) ?? {};
        for (const [playlistId, value] of Object.entries(next)) {
            if (
                JSON.stringify(previous[playlistId]) !== JSON.stringify(value)
            ) {
                this.queue({ namespace, playlistId, value });
            }
        }
        for (const playlistId of Object.keys(previous)) {
            if (!(playlistId in next)) {
                this.queue({ namespace, playlistId, value: undefined });
            }
        }
        this.synced.set(namespace, next);
        this.scheduleFlush();
    }

    private queue(entry: PendingEntry): void {
        const key = entryKey(entry);
        this.pending.set(key, entry);
        this.edits.set(key, ++this.editCount);
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
    private requeue(
        entry: PendingEntry,
        editWhenSent: number | undefined
    ): void {
        const key = entryKey(entry);
        if (this.edits.get(key) === editWhenSent && !this.pending.has(key)) {
            this.pending.set(key, entry);
        }
    }

    private async send(entry: PendingEntry): Promise<void> {
        const edit = this.edits.get(entryKey(entry));
        try {
            if (entry.value === undefined) {
                await this.api.request(entryPath(entry), { method: 'DELETE' });
            } else {
                await this.api.sendJson('PUT', entryPath(entry), {
                    value: entry.value,
                });
            }
        } catch (error) {
            this.requeue(entry, edit);
            this.onWriteFailure(error);
        }
    }
}

function entryKey(entry: PendingEntry): string {
    return `${entry.namespace}|${entry.playlistId}`;
}

function splitEditKey(key: string): [string, string] {
    const separator = key.indexOf('|');
    return [key.slice(0, separator), key.slice(separator + 1)];
}

function entryPath(entry: PendingEntry): string {
    return `/user-state/${entry.namespace}/${encodeURIComponent(entry.playlistId)}`;
}

function parseMap(value: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}
