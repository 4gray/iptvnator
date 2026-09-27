import { computed, inject, Injectable, signal } from '@angular/core';
import {
    createEmptyParentalLockPlaylistLocks,
    isParentalLockPlaylistLocksEmpty,
    lockedStalkerCategoryIds,
    lockedXtreamCategoryIds,
    normalizeParentalLockPlaylistLocks,
    ParentalLockPlaylistLocks,
    ParentalLockStalkerCategoryType,
    ParentalLockStore,
    ParentalLockXtreamCategoryType,
} from '@iptvnator/shared/interfaces';
import { DatabaseService } from '../database-electron.service';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { ParentalLockStaleIndex } from './parental-lock-stale-index';
import { ParentalLockStorageService } from './parental-lock-storage';
import {
    lockRemovalGate,
    stampXtreamIndex,
    withM3uLocks,
    withPlaylistLocksInStore,
    withStalkerLocks,
    withXtreamLocks,
} from './parental-lock-store.util';

/**
 * A full replacement list, or an edit of the CURRENT list. The edit form is
 * evaluated inside the write queue, so single-row toggles issued back to
 * back each see the previous toggle's result instead of one shared snapshot.
 */
export type LockListEdit<T> = readonly T[] | ((current: readonly T[]) => T[]);

function applyLockListEdit<T>(
    edit: LockListEdit<T>,
    current: readonly T[]
): T[] {
    return typeof edit === 'function' ? edit(current) : [...edit];
}

const XTREAM_CATEGORY_TYPES: readonly ParentalLockXtreamCategoryType[] = [
    'live',
    'movies',
    'series',
];

/**
 * The lock store: WHICH categories are locked, per playlist, persisted
 * through `ParentalLockStorageService`. Knows nothing about the PIN or the
 * session state — `ParentalLockService` composes it and adds `active`.
 *
 * A store that could not be READ is a distinct state (`unreadable`): it is
 * not "nothing is locked", and no write may be built on the empty in-memory
 * store while it lasts, or the persisted locks would be wiped.
 */
@Injectable({ providedIn: 'root' })
export class ParentalLockLockStore {
    private readonly storage = inject(ParentalLockStorageService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly databaseService = inject(DatabaseService);

    private readonly locks = signal<ParentalLockStore>({});
    private readonly revisionState = signal(0);
    private readonly loadedState = signal(false);
    private loading: Promise<void> | null = null;
    /**
     * Whether an edit may REMOVE a lock right now; set by
     * `ParentalLockService` to "the session is not locked". Asked inside
     * the write queue right before the edit's first write: an editor opened
     * while unlocked may still be saving (or queued) when the app relocks.
     * A relock that lands once the write is issued is ordered after it: the
     * parent authorized that removal, so it completes.
     */
    private mayRemoveLocks: () => boolean = () => true;
    /**
     * Mutations run one at a time: each rewrites the WHOLE persisted store
     * from the in-memory copy, so two overlapping edits would snapshot the
     * same store and the later write would silently drop the earlier edit.
     */
    private writeQueue: Promise<unknown> = Promise.resolve();
    /**
     * The persisted store differs from the in-memory one and must be
     * rewritten from it: "Remove all playlists" could not clear it, or a
     * failed edit could not be rolled back. Retried on the next store
     * access (before the index is re-stamped from memory); the store is not
     * `readable` meanwhile.
     */
    private readonly pendingRewrite = signal(false);
    private readonly staleIndex = new ParentalLockStaleIndex();

    /** The persisted store could not be read; see `ensureReadable()`. */
    readonly unreadable = signal(false);
    /**
     * The store has been read, is trustworthy, and (on Electron) the SQLite
     * index agrees with it. False while the initial read is still in flight
     * — the settings can report the feature as on before the locks are
     * known, and an empty in-memory store must not read as "nothing is
     * locked" in that window — and while a re-stamp is outstanding, since
     * Electron reads filter by the index alone.
     */
    readonly readable = computed(
        () =>
            this.loadedState() &&
            !this.unreadable() &&
            !this.pendingRewrite() &&
            this.staleIndex.isEmpty()
    );
    /** Bumps whenever the lock set changes; consumers re-query. */
    readonly revision = this.revisionState.asReadonly();
    readonly isEmpty = computed(() => Object.keys(this.locks()).length === 0);

    /**
     * Reads the persisted store once. On Electron the `categories.locked`
     * index is then re-derived from it for every playlist that has locks:
     * the store is authoritative, and a re-stamp that failed in an earlier
     * session (or a database restored beside a newer store) must not leave
     * the index behind indefinitely.
     */
    load(): Promise<void> {
        if (!this.loading) {
            this.loading = (async () => {
                const locks = await this.storage.readLocks();
                if (locks === null) {
                    console.error('The parental lock store could not be read.');
                    this.unreadable.set(true);
                } else {
                    this.locks.set(locks);
                    for (const playlistId of Object.keys(locks)) {
                        this.staleIndex.mark(playlistId);
                    }
                    // Awaited: catalog reads issued before the index agrees
                    // with the store would serve rows stamped unlocked, and
                    // nothing would reload them afterwards.
                    await this.reconcileXtreamIndex();
                }
                this.loadedState.set(true);
                this.revisionState.update((value) => value + 1);
            })();
        }
        return this.loading;
    }

    /**
     * Re-reads a store that failed to read earlier. False while it still
     * cannot be read.
     */
    async ensureReadable(): Promise<boolean> {
        await this.load();
        if (this.pendingRewrite() && !(await this.rewritePersistedStore())) {
            return false;
        }
        if (this.unreadable()) {
            const locks = await this.storage.readLocks();
            if (locks === null) {
                return false;
            }
            this.locks.set(locks);
            this.unreadable.set(false);
            // The index may carry stamps from a write that failed before
            // the read did; re-derive it from the recovered store as load()
            // does.
            for (const playlistId of Object.keys(locks)) {
                this.staleIndex.mark(playlistId);
            }
            this.revisionState.update((value) => value + 1);
        }
        await this.reconcileXtreamIndex();
        return this.readable();
    }

    /** Re-stamps every playlist whose index may lag behind the store. */
    private async reconcileXtreamIndex(): Promise<void> {
        if (!this.runtime.supportsXtreamSqliteDataSource) {
            this.staleIndex.clear();
            return;
        }
        if (
            await this.staleIndex.reconcile((id) => this.stampXtreamLocks(id))
        ) {
            this.revisionState.update((value) => value + 1);
        }
    }

    setRemovalGate(gate: () => boolean): void {
        this.mayRemoveLocks = gate;
    }

    locksFor(playlistId: string): ParentalLockPlaylistLocks {
        return (
            this.locks()[playlistId] ?? createEmptyParentalLockPlaylistLocks()
        );
    }

    lockedXtreamIds(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType
    ): number[] {
        return lockedXtreamCategoryIds(this.locks()[playlistId], categoryType);
    }

    lockedStalkerIds(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType
    ): string[] {
        return lockedStalkerCategoryIds(this.locks()[playlistId], categoryType);
    }

    lockedGroupTitles(playlistId: string): string[] {
        return this.locks()[playlistId]?.m3u ?? [];
    }

    /**
     * Every mutation re-reads a store that failed to read BEFORE building
     * the edit: `locksFor` on the empty fail-closed store would otherwise
     * turn one type's edit into the playlist's entire lock set once the
     * write goes through, discarding its other locks.
     */
    async setXtreamLocks(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType,
        xtreamIds: LockListEdit<number>
    ): Promise<boolean> {
        return this.enqueue(async () => {
            if (!(await this.ensureReadable())) {
                return false;
            }
            const previous = this.locksFor(playlistId);
            const next = withXtreamLocks(
                previous,
                categoryType,
                applyLockListEdit(
                    xtreamIds,
                    this.lockedXtreamIds(playlistId, categoryType)
                )
            );
            return this.commitLocks(playlistId, previous, next, [categoryType]);
        });
    }

    async setStalkerLocks(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType,
        categoryIds: LockListEdit<string>
    ): Promise<boolean> {
        return this.enqueue(async () => {
            if (!(await this.ensureReadable())) {
                return false;
            }
            const previous = this.locksFor(playlistId);
            const next = withStalkerLocks(
                previous,
                categoryType,
                applyLockListEdit(
                    categoryIds,
                    this.lockedStalkerIds(playlistId, categoryType)
                )
            );
            return this.persistEdit(playlistId, previous, next);
        });
    }

    async setM3uLocks(
        playlistId: string,
        groupTitles: LockListEdit<string>
    ): Promise<boolean> {
        return this.enqueue(async () => {
            if (!(await this.ensureReadable())) {
                return false;
            }
            const previous = this.locksFor(playlistId);
            const next = withM3uLocks(
                previous,
                applyLockListEdit(
                    groupTitles,
                    this.lockedGroupTitles(playlistId)
                )
            );
            return this.persistEdit(playlistId, previous, next);
        });
    }

    /** Backup restore: replaces every lock of one playlist. */
    async replacePlaylistLocks(
        playlistId: string,
        locks: ParentalLockPlaylistLocks
    ): Promise<boolean> {
        return this.enqueue(async () => {
            if (!(await this.ensureReadable())) {
                return false;
            }
            return this.commitLocks(
                playlistId,
                this.locksFor(playlistId),
                locks,
                XTREAM_CATEGORY_TYPES
            );
        });
    }

    /**
     * A deleted playlist's locks leave the store. No re-stamp: its category
     * rows are deleted with it. True when there was nothing to remove.
     */
    removePlaylist(playlistId: string): Promise<boolean> {
        return this.enqueue(async () => {
            if (!(await this.ensureReadable())) {
                return false;
            }
            if (!this.locks()[playlistId]) {
                return true;
            }
            return this.persistPlaylistLocks(
                playlistId,
                createEmptyParentalLockPlaylistLocks()
            );
        });
    }

    /** "Remove all playlists": every lock goes with them. */
    clearAll(): Promise<boolean> {
        return this.enqueue(async () => {
            await this.load();
            // The playlists are gone either way: the in-memory store empties
            // now, and a failed persisted clear is retried on the next
            // store access (`ensureReadable`) and by the next write, which
            // rewrites the whole store from this empty copy.
            this.locks.set({});
            this.unreadable.set(false);
            this.staleIndex.clear();
            this.revisionState.update((value) => value + 1);
            return this.rewritePersistedStore();
        });
    }

    /** Stalker and M3U edits: no index, only the store write. */
    private async persistEdit(
        playlistId: string,
        previous: ParentalLockPlaylistLocks,
        next: ParentalLockPlaylistLocks
    ): Promise<boolean> {
        return (
            lockRemovalGate(previous, next, this.mayRemoveLocks)() &&
            this.persistPlaylistLocks(playlistId, next)
        );
    }

    /** Writes the in-memory store; a failure leaves `pendingRewrite` set. */
    private async rewritePersistedStore(): Promise<boolean> {
        const written = await this.storage.writeLocks(this.locks());
        if (!written) {
            console.error('The parental lock store could not be rewritten.');
        }
        if (written === this.pendingRewrite()) {
            this.pendingRewrite.set(!written);
            this.revisionState.update((value) => value + 1);
        }
        return written;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.writeQueue.then(task, task);
        this.writeQueue = run.catch(() => undefined);
        return run;
    }

    /**
     * Persists `next` and re-stamps the touched types. Order matters for a
     * playlist whose LAST lock goes away: its key leaves the store, and the
     * startup reconcile finds playlists only through their key — a crash
     * between the two writes would strand stamped rows for good. That case
     * clears the index first (from `next`) and persists afterwards, so an
     * interruption leaves the store with the lock and the index without it,
     * which the next reconcile repairs toward locked. Every other write
     * persists first and rolls back on a failed re-stamp.
     */
    private async commitLocks(
        playlistId: string,
        previous: ParentalLockPlaylistLocks,
        next: ParentalLockPlaylistLocks,
        categoryTypes: readonly ParentalLockXtreamCategoryType[]
    ): Promise<boolean> {
        const authorized = lockRemovalGate(previous, next, this.mayRemoveLocks);
        const normalizedNext = normalizeParentalLockPlaylistLocks(next);
        if (isParentalLockPlaylistLocksEmpty(normalizedNext)) {
            if (!(await this.ensureReadable()) || !authorized()) {
                return false;
            }
            // Stale until the STORE write has landed too: while it is
            // pending the index is already cleared but the store still
            // holds the lock, and a relock in that window must not reload
            // through the cleared index.
            this.markStaleWhileStamping(playlistId);
            if (
                (await this.stampXtreamLocks(
                    playlistId,
                    categoryTypes,
                    normalizedNext
                )) &&
                (await this.persistPlaylistLocks(playlistId, normalizedNext, {
                    publish: false,
                }))
            ) {
                this.staleIndex.unmark(playlistId);
                this.revisionState.update((value) => value + 1);
                return true;
            }
            // The clear (partly) reached the index but the store still holds
            // the locks: put the index back at once — consumers that query
            // the worker directly (title matching, multi-source discovery)
            // trust `locked` and are not gated by the renderer's stale flag.
            await this.restoreIndex(playlistId, previous, categoryTypes);
            return false;
        }
        // The revision is published only once every type is stamped: a
        // consumer reloading on the revision while the stamps are still
        // running would read a later type through its old stamps, and a
        // successful stamp emits nothing afterwards to reload it.
        if (
            !authorized() ||
            !(await this.persistPlaylistLocks(playlistId, next, {
                publish: false,
            }))
        ) {
            return false;
        }
        this.markStaleWhileStamping(playlistId);
        if (await this.stampXtreamLocks(playlistId, categoryTypes)) {
            this.staleIndex.unmark(playlistId);
            this.revisionState.update((value) => value + 1);
            return true;
        }
        await this.rollBack(playlistId, previous, categoryTypes);
        return false;
    }

    /**
     * The store commits before the SQLite index is re-stamped; a failed
     * re-stamp would otherwise leave a category recorded (and shown) as
     * locked while Electron reads, which filter by the index alone, still
     * serve it. The store goes back to the previous locks and the touched
     * types are re-stamped from it — a multi-type re-stamp may have
     * committed some types before the failing one. If either step fails,
     * the playlist is marked stale, which keeps the session fail-closed and
     * re-stamps it on the next access.
     */
    private async rollBack(
        playlistId: string,
        previous: ParentalLockPlaylistLocks,
        categoryTypes: readonly ParentalLockXtreamCategoryType[]
    ): Promise<void> {
        // Published once, after the re-stamp: a reload on an earlier
        // revision would read a later type through the attempted stamps.
        const restored = await this.persistPlaylistLocks(playlistId, previous, {
            publish: false,
        });
        if (!restored) {
            // Memory goes back to the previous locks anyway, and the
            // persisted copy is rewritten from it on the next access: the
            // failed edit must not take effect through a later re-stamp.
            this.locks.set(
                withPlaylistLocksInStore(this.locks(), playlistId, previous)
            );
            this.pendingRewrite.set(true);
        }
        const restamped =
            restored &&
            (await this.stampXtreamLocks(playlistId, categoryTypes));
        if (!restored || !restamped) {
            console.error('Failed to roll back the parental lock index.');
            this.staleIndex.mark(playlistId);
        } else {
            this.staleIndex.unmark(playlistId);
        }
        this.revisionState.update((value) => value + 1);
    }

    /**
     * From the store change until every stamp has landed the SQLite index
     * does not agree with the store: `readable` must be false for that whole
     * window, or a relock inside it would reload through the old stamps.
     * Only Electron has the index.
     */
    private markStaleWhileStamping(playlistId: string): void {
        if (this.runtime.supportsXtreamSqliteDataSource) {
            this.staleIndex.markInFlight(playlistId);
        }
    }

    /** Re-stamps the index from `locks`; marks it stale when that fails. */
    private async restoreIndex(
        playlistId: string,
        locks: ParentalLockPlaylistLocks,
        categoryTypes: readonly ParentalLockXtreamCategoryType[]
    ): Promise<void> {
        if (!(await this.stampXtreamLocks(playlistId, categoryTypes, locks))) {
            console.error('Failed to restore the parental lock index.');
            this.staleIndex.mark(playlistId);
        } else {
            this.staleIndex.unmark(playlistId);
        }
        this.revisionState.update((value) => value + 1);
    }

    /**
     * Re-stamps the Electron `categories.locked` index for a playlist from
     * the store, e.g. after a refresh recreated the rows.
     */
    async stampXtreamLocks(
        playlistId: string,
        categoryTypes: readonly ParentalLockXtreamCategoryType[] = XTREAM_CATEGORY_TYPES,
        locks: ParentalLockPlaylistLocks = this.locksFor(playlistId)
    ): Promise<boolean> {
        return (
            !this.runtime.supportsXtreamSqliteDataSource ||
            stampXtreamIndex(
                (id, type, ids) =>
                    this.databaseService.setCategoryLocks(id, type, ids),
                playlistId,
                categoryTypes,
                locks
            )
        );
    }

    private async persistPlaylistLocks(
        playlistId: string,
        locks: ParentalLockPlaylistLocks,
        options: { publish?: boolean } = {}
    ): Promise<boolean> {
        // Every public mutation runs `ensureReadable()` before it builds its
        // edit. Here only the STORE must be known: the index of the
        // playlist being written is deliberately stale while it is
        // re-stamped, and a rollback must still be able to write.
        if (this.unreadable()) {
            return false;
        }
        const next = withPlaylistLocksInStore(this.locks(), playlistId, locks);
        if (!(await this.storage.writeLocks(next))) {
            return false;
        }
        this.locks.set(next);
        if (options.publish !== false) {
            this.revisionState.update((value) => value + 1);
        }
        return true;
    }
}
