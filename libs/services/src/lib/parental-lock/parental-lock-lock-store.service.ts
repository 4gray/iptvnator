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
import { ParentalLockStorageService } from './parental-lock-storage';
import {
    withM3uLocks,
    withStalkerLocks,
    withXtreamLocks,
} from './parental-lock-store.util';

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
     * Playlists whose SQLite index could not be brought in line with the
     * store (a failed re-stamp whose rollback failed too); re-stamped on
     * the next store access.
     */
    private readonly staleIndexPlaylists = new Set<string>();
    private readonly staleIndexCount = signal(0);

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
            this.staleIndexCount() === 0
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
                        this.markIndexStale(playlistId);
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
                this.markIndexStale(playlistId);
            }
            this.revisionState.update((value) => value + 1);
        }
        await this.reconcileXtreamIndex();
        return this.readable();
    }

    private markIndexStale(playlistId: string): void {
        this.staleIndexPlaylists.add(playlistId);
        this.staleIndexCount.set(this.staleIndexPlaylists.size);
    }

    /** Re-stamps every playlist whose index may lag behind the store. */
    private async reconcileXtreamIndex(): Promise<void> {
        if (!this.runtime.supportsXtreamSqliteDataSource) {
            this.staleIndexPlaylists.clear();
            this.staleIndexCount.set(0);
            return;
        }
        for (const playlistId of [...this.staleIndexPlaylists]) {
            try {
                if (await this.stampXtreamLocks(playlistId)) {
                    this.staleIndexPlaylists.delete(playlistId);
                }
            } catch (error) {
                console.error(
                    'Failed to reconcile the parental lock index.',
                    error
                );
            }
        }
        if (this.staleIndexCount() !== this.staleIndexPlaylists.size) {
            this.staleIndexCount.set(this.staleIndexPlaylists.size);
            this.revisionState.update((value) => value + 1);
        }
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
        xtreamIds: number[]
    ): Promise<boolean> {
        if (!(await this.ensureReadable())) {
            return false;
        }
        const previous = this.locksFor(playlistId);
        const next = withXtreamLocks(previous, categoryType, xtreamIds);
        return this.commitLocks(playlistId, previous, next, [categoryType]);
    }

    async setStalkerLocks(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType,
        categoryIds: string[]
    ): Promise<boolean> {
        if (!(await this.ensureReadable())) {
            return false;
        }
        return this.persistPlaylistLocks(
            playlistId,
            withStalkerLocks(
                this.locksFor(playlistId),
                categoryType,
                categoryIds
            )
        );
    }

    async setM3uLocks(
        playlistId: string,
        groupTitles: string[]
    ): Promise<boolean> {
        if (!(await this.ensureReadable())) {
            return false;
        }
        return this.persistPlaylistLocks(
            playlistId,
            withM3uLocks(this.locksFor(playlistId), groupTitles)
        );
    }

    /** Backup restore: replaces every lock of one playlist. */
    async replacePlaylistLocks(
        playlistId: string,
        locks: ParentalLockPlaylistLocks
    ): Promise<boolean> {
        if (!(await this.ensureReadable())) {
            return false;
        }
        return this.commitLocks(
            playlistId,
            this.locksFor(playlistId),
            locks,
            XTREAM_CATEGORY_TYPES
        );
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
        const normalizedNext = normalizeParentalLockPlaylistLocks(next);
        if (isParentalLockPlaylistLocksEmpty(normalizedNext)) {
            if (!(await this.ensureReadable())) {
                return false;
            }
            if (
                !(await this.stampXtreamLocks(
                    playlistId,
                    categoryTypes,
                    normalizedNext
                ))
            ) {
                return false;
            }
            if (await this.persistPlaylistLocks(playlistId, normalizedNext)) {
                return true;
            }
            this.markIndexStale(playlistId);
            this.revisionState.update((value) => value + 1);
            return false;
        }
        if (!(await this.persistPlaylistLocks(playlistId, next))) {
            return false;
        }
        if (await this.stampXtreamLocks(playlistId, categoryTypes)) {
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
        const restored = await this.persistPlaylistLocks(playlistId, previous);
        const restamped =
            restored &&
            (await this.stampXtreamLocks(playlistId, categoryTypes));
        if (!restored || !restamped) {
            console.error('Failed to roll back the parental lock index.');
            this.markIndexStale(playlistId);
            this.revisionState.update((value) => value + 1);
        }
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
        if (!this.runtime.supportsXtreamSqliteDataSource) {
            return true;
        }
        let success = true;
        for (const categoryType of categoryTypes) {
            success =
                (await this.databaseService.setCategoryLocks(
                    playlistId,
                    categoryType,
                    lockedXtreamCategoryIds(locks, categoryType)
                )) && success;
        }
        return success;
    }

    private async persistPlaylistLocks(
        playlistId: string,
        locks: ParentalLockPlaylistLocks
    ): Promise<boolean> {
        if (!(await this.ensureReadable())) {
            return false;
        }
        const normalized = normalizeParentalLockPlaylistLocks(locks);
        const next: ParentalLockStore = { ...this.locks() };
        if (isParentalLockPlaylistLocksEmpty(normalized)) {
            delete next[playlistId];
        } else {
            next[playlistId] = normalized;
        }
        if (!(await this.storage.writeLocks(next))) {
            return false;
        }
        this.locks.set(next);
        this.revisionState.update((value) => value + 1);
        return true;
    }
}
