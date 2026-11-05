import type { ServerUserStateNamespace } from '@iptvnator/shared/interfaces';
import { type AnsweredWrites, applyAnswer } from './server-user-data-answer';
import {
    entryKey,
    addStep,
    behind,
    type EditStep,
    type PendingEntry,
    uncertain,
    UNKNOWN_TAG,
} from './server-user-data-entries';
import {
    sendEntry,
    sendEntryKeepalive,
    type ServerApi,
} from './server-user-data-send';
import { UserStateTags } from './server-user-data-tags';
import { newestWrites } from './server-unsent-writes';

const FLUSH_DELAY_MS = 500;

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
    /** False while nothing may go out (another tab took the writes over). */
    readonly maySend?: () => boolean;
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
    readonly tags = new UserStateTags();
    private readonly pending = new Map<string, PendingEntry>();
    /** Writes still travelling (normal or page-hide), by entry key. */
    private readonly inFlight = new Map<string, PendingEntry>();
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    /** Batches go out one at a time, so an older write never lands last. */
    private sending: Promise<void> = Promise.resolve();
    /** A page-hide batch sent at once, which a scheduled flush waits for. */
    private keepaliveRun: Promise<void> = Promise.resolve();
    private writesInFlight = 0;
    /** Edit counter per `namespace|playlistId`, for re-reads to keep them. */
    private readonly edits = new Map<string, number>();
    private editCount = 0;
    /** Entries a delete is waiting on: they stay queued and are not sent. */
    private readonly held: ((key: string) => boolean)[] = [];
    /** What the answer to a travelling write changes (`applyAnswer`). */
    private readonly answered: AnsweredWrites = {
        pending: this.pending,
        inFlight: this.inFlight,
        edits: this.edits,
        tags: this.tags,
        show: (namespace, playlistId, value) =>
            this.hooks.show(namespace, playlistId, value),
        writeFailed: (error) => this.hooks.writeFailed(error),
        scheduleFlush: () => this.scheduleFlush(),
    };

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

    /**
     * Queues an edit (`before` → `value`). A newer edit of an entry still
     * queued joins it; one behind a travelling write keeps that write's
     * steps (marked as sent) and tag. A `foreign` edit was made on another
     * tab's unsent change: its write must conflict and be replayed.
     */
    queue(
        namespace: ServerUserStateNamespace,
        playlistId: string,
        value: unknown,
        before: unknown,
        base: {
            readonly tag?: string | null;
            readonly steps?: readonly EditStep[];
            readonly foreign?: boolean;
        } = {}
    ): void {
        const key = `${namespace}|${playlistId}`;
        const queued = this.pending.get(key);
        const travelling = this.inFlight.get(key);
        const edit = ++this.editCount;
        let entry: PendingEntry;
        if (queued) {
            entry = {
                ...queued,
                value,
                edit,
                steps: addStep(queued.steps, before, value),
            };
        } else if (travelling) {
            entry = {
                ...travelling,
                value,
                edit,
                steps: [...behind(travelling), { before, after: value }],
            };
        } else {
            entry = {
                namespace,
                playlistId,
                value,
                edit,
                tag:
                    base.tag !== undefined
                        ? base.tag
                        : this.tags.of(namespace, playlistId),
                steps: base.steps
                    ? uncertain(base.steps)
                    : [{ before, after: value }],
            };
        }
        if (base.foreign) {
            entry = { ...entry, tag: UNKNOWN_TAG };
        }
        this.pending.set(key, entry);
        this.edits.set(key, edit);
    }

    /** The write of an entry: queued, else travelling. */
    unsent(key: string): PendingEntry | undefined {
        return this.pending.get(key) ?? this.inFlight.get(key);
    }

    isQueued(key: string): boolean {
        return this.pending.has(key);
    }

    /** Queues `entry` as this tab's newest edit of it. */
    put(entry: Omit<PendingEntry, 'edit'>): void {
        const key = entryKey(entry as PendingEntry);
        const edit = ++this.editCount;
        this.pending.set(key, { ...entry, edit });
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
            // A page-hide batch that went out at once in the meantime is
            // not chained on this one: its writes land first.
            await this.keepaliveRun;
            await this.sendBatch(false);
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
        const now = this.writesInFlight === 0;
        const run = now
            ? this.sendBatch(true)
            : this.sending.then(() => this.sendBatch(true));
        this.sending = run.then(
            () => undefined,
            () => undefined
        );
        if (now) {
            this.keepaliveRun = this.sending;
        }
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
        this.tags.forget(playlistId);
        this.hooks.changed();
    }

    private takePending(): PendingEntry[] {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.hooks.maySend?.() === false) {
            return [];
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

    /** Sends the queued entries; `keepalive` ones survive the page. */
    private async sendBatch(keepalive: boolean): Promise<void> {
        const batch = this.takePending();
        if (batch.length === 0) {
            return;
        }
        for (const entry of batch) {
            this.inFlight.set(entryKey(entry), entry);
        }
        if (keepalive) {
            // The page may not live to see the answers.
            this.hooks.changed();
        }
        this.writesInFlight += 1;
        try {
            await Promise.all(
                batch.map((entry) => this.send(entry, keepalive))
            );
        } finally {
            this.writesInFlight -= 1;
        }
    }

    private async send(entry: PendingEntry, keepalive: boolean): Promise<void> {
        const outcome = await (keepalive ? sendEntryKeepalive : sendEntry)(
            this.api,
            entry
        );
        applyAnswer(this.answered, entry, outcome);
        this.hooks.changed();
    }
}
