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
    private loading: Promise<void> | null = null;

    /** The persisted store could not be read; see `ensureReadable()`. */
    readonly unreadable = signal(false);
    /** Bumps whenever the lock set changes; consumers re-query. */
    readonly revision = this.revisionState.asReadonly();
    readonly isEmpty = computed(() => Object.keys(this.locks()).length === 0);

    /** Reads the persisted store once. */
    load(): Promise<void> {
        if (!this.loading) {
            this.loading = this.storage.readLocks().then((locks) => {
                if (locks === null) {
                    console.error('The parental lock store could not be read.');
                    this.unreadable.set(true);
                    return;
                }
                this.locks.set(locks);
            });
        }
        return this.loading;
    }

    /**
     * Re-reads a store that failed to read earlier. False while it still
     * cannot be read.
     */
    async ensureReadable(): Promise<boolean> {
        await this.load();
        if (!this.unreadable()) {
            return true;
        }
        const locks = await this.storage.readLocks();
        if (locks === null) {
            return false;
        }
        this.locks.set(locks);
        this.unreadable.set(false);
        this.revisionState.update((value) => value + 1);
        return true;
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

    async setXtreamLocks(
        playlistId: string,
        categoryType: ParentalLockXtreamCategoryType,
        xtreamIds: number[]
    ): Promise<boolean> {
        const next = withXtreamLocks(
            this.locksFor(playlistId),
            categoryType,
            xtreamIds
        );
        if (!(await this.persistPlaylistLocks(playlistId, next))) {
            return false;
        }
        return this.stampXtreamLocks(playlistId, [categoryType]);
    }

    async setStalkerLocks(
        playlistId: string,
        categoryType: ParentalLockStalkerCategoryType,
        categoryIds: string[]
    ): Promise<boolean> {
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
        if (!(await this.persistPlaylistLocks(playlistId, locks))) {
            return false;
        }
        return this.stampXtreamLocks(playlistId, XTREAM_CATEGORY_TYPES);
    }

    /**
     * Re-stamps the Electron `categories.locked` index for a playlist from
     * the store, e.g. after a refresh recreated the rows.
     */
    async stampXtreamLocks(
        playlistId: string,
        categoryTypes: readonly ParentalLockXtreamCategoryType[] = XTREAM_CATEGORY_TYPES
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
                    this.lockedXtreamIds(playlistId, categoryType)
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
