import type {
    ServerUserStateCurrent,
    ServerUserStateNamespace,
    ServerUserStateWriteResponse,
} from '@iptvnator/shared/interfaces';
import { ServerApiError, type ServerApiClient } from './server-api-client';
import {
    entryKey,
    entryPath,
    type PendingEntry,
    preconditionHeaders,
    type PriorEdit,
} from './server-user-data-entries';
import { applyEdit } from './server-user-data-edit';
import { newestWrites } from './server-unsent-writes';

const FLUSH_DELAY_MS = 500;

type ServerApi = Pick<
    ServerApiClient,
    'readJson' | 'sendJson' | 'request' | 'sendKeepalive'
>;

export interface UserDataQueueHooks {
    /** The queue or the writes travelling changed: persist them. */
    readonly changed: () => void;
    /** A conflict replay changed what an entry should show. */
    readonly show: (
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown
    ) => void;
    readonly writeFailed: (error: unknown) => void;
}

/**
 * The writes of `ServerUserDataStorage`: one entry per playlist and
 * namespace, sent in batches one after another, each based on the server
 * version (tag) it was read at. A `412` replays the edit (before → after)
 * on the server's current value; a failure keeps it queued unless a newer
 * edit replaced it.
 */
export class UserDataWriteQueue {
    /** Server version tag per entry; absent until the first read. */
    private readonly tags = new Map<
        ServerUserStateNamespace,
        Record<string, string>
    >();
    private readonly pending = new Map<string, PendingEntry>();
    /** Writes still travelling (normal or page-hide), by entry key. */
    private readonly inFlight = new Map<string, PendingEntry>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    /** Batches go out one at a time, so an older write never lands last. */
    private sending: Promise<void> = Promise.resolve();
    private writesInFlight = 0;
    /** Edit counter per `namespace|playlistId`, for re-reads to keep them. */
    private readonly edits = new Map<string, number>();
    private editCount = 0;
    /** Entries a delete is waiting on: they stay queued and are not sent. */
    private readonly held: ((key: string) => boolean)[] = [];

    constructor(
        private readonly api: ServerApi,
        private readonly hooks: UserDataQueueHooks
    ) {}

    get lastEdit(): number {
        return this.editCount;
    }

    hasUnsent(): boolean {
        return this.pending.size > 0 || this.inFlight.size > 0;
    }

    /** What the server has not confirmed, the newest write per entry. */
    unsentWrites(): PendingEntry[] {
        return newestWrites([
            ...this.inFlight.values(),
            ...this.pending.values(),
        ]);
    }

    unconfirmedKeys(): string[] {
        return [...this.pending.keys(), ...this.inFlight.keys()];
    }

    /** Entries a re-read must not replace: unconfirmed or edited since. */
    unsavedSince(edit: number): Set<string> {
        const keys = new Set(this.unconfirmedKeys());
        for (const [key, made] of this.edits) {
            if (made > edit) {
                keys.add(key);
            }
        }
        return keys;
    }

    /** Forgets edit numbers a re-read has covered. */
    settledUpTo(edit: number): void {
        for (const [key, made] of this.edits) {
            if (
                made <= edit &&
                !this.pending.has(key) &&
                !this.inFlight.has(key)
            ) {
                this.edits.delete(key);
            }
        }
    }

    setTags(
        namespace: ServerUserStateNamespace,
        tags: Readonly<Record<string, string>>
    ): void {
        this.tags.set(namespace, { ...tags });
    }

    /**
     * Queues an edit (`before` → `value`). A newer edit of an entry still
     * queued joins it; one behind a travelling write keeps its own edit,
     * carries the write's as `prior` and is based on the write's tag.
     */
    queue(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown,
        before: unknown,
        tag = this.tagFor(namespace, playlistId),
        prior?: Omit<PriorEdit, 'edit'>
    ): void {
        const key = `${namespace}|${playlistId}`;
        const queued = this.pending.get(key);
        const travelling = this.inFlight.get(key);
        const edit = ++this.editCount;
        let entry: PendingEntry;
        if (queued) {
            entry = { ...queued, value, edit };
        } else if (travelling) {
            entry = {
                namespace,
                playlistId,
                value,
                edit,
                before,
                tag: travelling.tag,
                prior: {
                    before: travelling.prior
                        ? travelling.prior.before
                        : travelling.before,
                    after: travelling.value,
                    edit: travelling.edit,
                },
            };
        } else {
            entry = { namespace, playlistId, value, edit, before, tag };
            if (prior) {
                entry = { ...entry, prior: { ...prior, edit: 0 } };
            }
        }
        this.pending.set(key, entry);
        this.edits.set(key, edit);
    }

    scheduleFlush(): void {
        if (this.pending.size === 0) {
            return;
        }
        // Saved at once: another tab's re-read must not replace them.
        this.hooks.changed();
        if (this.flushTimer !== null) {
            return;
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
        }, FLUSH_DELAY_MS);
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
        // Saved first: the page may be gone before anything is answered.
        this.hooks.changed();
        if (this.pending.size === 0) {
            return;
        }
        // Idle: send synchronously, while the hiding page still runs. Behind
        // a travelling write the entries stay queued until it is answered,
        // so the version it created can still become their baseline.
        const run =
            this.writesInFlight === 0
                ? this.sendKeepaliveBatch()
                : this.sending.then(() => this.sendKeepaliveBatch());
        this.sending = run.then(
            () => undefined,
            () => undefined
        );
    }

    /**
     * Keeps the entries whose key `matches` queued but unsent until the
     * returned release is called (a delete is running).
     */
    hold(matches: (key: string) => boolean): () => void {
        this.held.push(matches);
        return () => {
            this.held.splice(this.held.indexOf(matches), 1);
            this.scheduleFlush();
        };
    }

    /** Resolves once the writes travelling now have been answered. */
    whenSent(): Promise<void> {
        return this.sending;
    }

    /**
     * After a delete: forgets the queued edits whose key `matches`, their
     * edit numbers and their tags (all tags without a playlist id).
     */
    drop(matches: (key: string) => boolean, playlistId?: string): void {
        for (const store of [this.pending, this.edits]) {
            for (const key of [...store.keys()]) {
                if (matches(key)) {
                    store.delete(key);
                }
            }
        }
        for (const [namespace, tags] of this.tags) {
            if (playlistId === undefined) {
                this.tags.set(namespace, {});
            } else {
                delete tags[playlistId];
            }
        }
        this.hooks.changed();
    }

    /** `undefined` until the server's tags are known (or not offered). */
    private tagFor(
        namespace: ServerUserStateNamespace,
        playlistId: string
    ): string | null | undefined {
        const tags = this.tags.get(namespace);
        return tags ? (tags[playlistId] ?? null) : undefined;
    }

    private setTag(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        tag: string | null
    ): void {
        const tags = this.tags.get(namespace);
        if (!tags) {
            return;
        }
        if (tag === null) {
            delete tags[playlistId];
        } else {
            tags[playlistId] = tag;
        }
    }

    private takePending(): PendingEntry[] {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        const batch: PendingEntry[] = [];
        for (const [key, entry] of this.pending) {
            if (!this.held.some((matches) => matches(key))) {
                batch.push(entry);
                this.pending.delete(key);
            }
        }
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

    /** A newer write of the same entry may have replaced it meanwhile. */
    private retireInFlight(entry: PendingEntry): void {
        const key = entryKey(entry);
        if (this.inFlight.get(key)?.edit === entry.edit) {
            this.inFlight.delete(key);
        }
    }

    private async sendKeepaliveBatch(): Promise<void> {
        const entries = this.takePending();
        if (entries.length === 0) {
            return;
        }
        for (const entry of entries) {
            this.inFlight.set(entryKey(entry), entry);
        }
        this.hooks.changed();
        this.writesInFlight += 1;
        try {
            await Promise.all(
                entries.map((entry) => this.sendKeepalive(entry))
            );
        } finally {
            this.writesInFlight -= 1;
        }
    }

    private async sendKeepalive(entry: PendingEntry): Promise<void> {
        const path = entryPath(entry);
        const headers = preconditionHeaders(entry.tag);
        const outcome = await (entry.value === undefined
            ? this.api.sendKeepalive('DELETE', path, undefined, headers)
            : this.api.sendKeepalive(
                  'PUT',
                  path,
                  { value: entry.value },
                  headers
              ));
        this.retireInFlight(entry);
        if (outcome.status === 'saved') {
            // Without a tag a newer edit keeps this one as `prior`.
            if (outcome.tag !== undefined) {
                this.confirmed(entry, outcome.tag);
            }
        } else if (outcome.status === 'conflict') {
            this.replayOnConflict(entry, outcome.current);
        } else {
            this.requeue(entry);
        }
        this.hooks.changed();
    }

    private async send(entry: PendingEntry): Promise<void> {
        const headers = preconditionHeaders(entry.tag);
        try {
            const response =
                entry.value === undefined
                    ? await this.api.request(entryPath(entry), {
                          method: 'DELETE',
                          headers,
                      })
                    : await this.api.sendJson(
                          'PUT',
                          entryPath(entry),
                          { value: entry.value },
                          headers
                      );
            const { tag } = await this.api
                .readJson<Partial<ServerUserStateWriteResponse>>(response)
                .catch(() => ({ tag: undefined }));
            this.retireInFlight(entry);
            if (tag !== undefined) {
                this.confirmed(entry, tag);
            }
        } catch (error) {
            this.retireInFlight(entry);
            if (
                error instanceof ServerApiError &&
                error.status === 412 &&
                error.current
            ) {
                this.replayOnConflict(entry, error.current);
            } else {
                this.requeue(entry);
                this.hooks.writeFailed(error);
            }
        }
        this.hooks.changed();
    }

    /** The server took `entry`: the edit queued behind it builds on it. */
    private confirmed(entry: PendingEntry, tag: string | null): void {
        this.setTag(entry.namespace, entry.playlistId, tag);
        const key = entryKey(entry);
        const next = this.pending.get(key);
        if (next?.prior?.edit === entry.edit) {
            this.pending.set(key, { ...next, prior: undefined, tag });
        }
    }

    /**
     * Another device changed the entry and `entry` did not land: replay its
     * edits on the server's current value (with the newer queued edit that
     * carries it as `prior`, if any), show the result and send it on that
     * version.
     */
    private replayOnConflict(
        entry: PendingEntry,
        current: ServerUserStateCurrent
    ): void {
        this.setTag(entry.namespace, entry.playlistId, current.tag);
        const key = entryKey(entry);
        const latest =
            this.pending.get(key) ??
            (this.edits.get(key) === entry.edit ? entry : undefined);
        if (!latest) {
            return;
        }
        const merged = replay(current.value, latest);
        this.hooks.show(entry.namespace, entry.playlistId, merged);
        if (
            latest === entry &&
            JSON.stringify(merged) === JSON.stringify(current.value)
        ) {
            return;
        }
        this.pending.set(key, {
            ...latest,
            value: merged,
            before: current.value,
            tag: current.tag,
            prior: undefined,
        });
        this.scheduleFlush();
    }
}

/** An entry's edits, its `prior` first, applied to the server's value. */
function replay(server: unknown, entry: PendingEntry): unknown {
    const base = entry.prior
        ? applyEdit(server, entry.prior.before, entry.prior.after)
        : server;
    return applyEdit(base, entry.before, entry.value);
}
