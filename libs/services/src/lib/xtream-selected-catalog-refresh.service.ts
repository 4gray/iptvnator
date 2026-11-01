import { inject, Injectable, signal } from '@angular/core';
import {
    normalizeXtreamServerUrl,
    PlaylistMeta,
    XtreamCategory,
    XtreamContentType,
    XTREAM_REQUEST,
    XTREAM_CONTENT_TYPES,
    xtreamHistoryRecoveryKey,
} from '@iptvnator/shared/interfaces';
import { DataService } from './data.service';
import { DatabaseService } from './database-electron.service';
import { ParentalLockService } from './parental-lock';
import { SourceActivityService } from './source-activity.service';
import {
    sameXtreamCatalogConnection,
    XtreamCatalogCommitService,
    XtreamCatalogConnectionChangedError,
} from './xtream-catalog-commit.service';
import {
    XtreamPendingRestoreService,
    type XtreamPendingRestoreSnapshot,
} from './xtream-pending-restore.service';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';
import {
    beginCatalogHistoryRecovery,
    clearCatalogHistoryRecovery,
    completeCatalogHistoryRecovery,
    captureCatalogCacheRecoveryState,
} from './xtream-catalog-history-recovery';

const actions = {
    live: ['get_live_categories', 'get_live_streams'],
    movie: ['get_vod_categories', 'get_vod_streams'],
    series: ['get_series_categories', 'get_series'],
} as const;

export interface XtreamSelectedCatalogProgress {
    playlistId: string;
    type: XtreamContentType | null;
    phase:
        | 'loading-categories'
        | 'loading-content'
        | 'preparing'
        | 'saving-categories'
        | 'saving-content'
        | 'restoring';
    current: number;
    total: number;
}

/** Desktop edit-time refresh. Unchanged/disabled catalogs are never requested or deleted. */
@Injectable({ providedIn: 'root' })
export class XtreamSelectedCatalogRefreshService {
    private readonly data = inject(DataService);
    private readonly db = inject(DatabaseService);
    private readonly locks = inject(ParentalLockService);
    private readonly pending = inject(XtreamPendingRestoreService);
    private readonly deferred = inject(XtreamDeferredCatalogRestoreService);
    private readonly activity = inject(SourceActivityService);
    private readonly commit = inject(XtreamCatalogCommitService);
    private readonly progressState =
        signal<XtreamSelectedCatalogProgress | null>(null);
    readonly progress = this.progressState.asReadonly();

    async refresh(
        playlist: PlaylistMeta,
        types: XtreamContentType[],
        beforeReplace?: () => Promise<PlaylistMeta | void>
    ): Promise<void> {
        if (!types.length) return;
        if (
            this.progressState() ||
            this.activity.isBusy(playlist._id) ||
            this.pending.getOrThrow(playlist._id)
        ) {
            throw new Error(
                'Finish or retry the current source import before changing the loaded catalogs.'
            );
        }
        const release = this.activity.begin([playlist._id]);
        const incomplete = new Set<XtreamContentType>();
        const replaced = new Set<XtreamContentType>();
        let snapshot: XtreamPendingRestoreSnapshot | null = null;
        let historyPrepared = false;
        let replacementStarted = false;
        let acceptedConnectionChanged = false;
        let original: PlaylistMeta | null = null;
        let markersStaged = false;
        let metadataAccepted = false;
        let keepPreparedRecovery = false;
        const priorStatuses = new Map<XtreamContentType, string | null>();
        const publish = (
            type: XtreamContentType | null,
            phase: XtreamSelectedCatalogProgress['phase'],
            current = 0,
            total = 0
        ) =>
            this.progressState.set({
                playlistId: playlist._id,
                type,
                phase,
                current,
                total,
            });
        try {
            // Fetch before deleting any cache. A provider failure leaves the saved catalog intact.
            const catalogs = [];
            for (const type of types) {
                publish(type, 'loading-categories');
                const categories = await this.request<XtreamCategory>(
                    playlist,
                    actions[type][0]
                );
                publish(type, 'loading-content');
                const content = await this.request<Record<string, unknown>>(
                    playlist,
                    actions[type][1]
                );
                catalogs.push({ type, categories, content });
            }
            publish(null, 'preparing');
            // Park user state BEFORE deletion so storage failure cannot erase history.
            const available = types;
            const prepared = await captureCatalogCacheRecoveryState(
                this.db,
                this.deferred,
                playlist._id,
                available
            );
            const saved = prepared.state;
            snapshot = this.pending.set(playlist._id, saved);
            if (!snapshot) {
                throw new Error('Could not retain source restore state.');
            }
            await beginCatalogHistoryRecovery(
                this.db,
                playlist._id,
                [...XTREAM_CONTENT_TYPES],
                prepared.archivedHistory
            );
            historyPrepared = true;
            if (beforeReplace)
                original = await this.commit.readCurrent(playlist._id);
            if (original) {
                // Acceptance may return a newer connection than either input.
                // Stage every attempted type before invoking that boundary.
                for (const type of types) {
                    const row = await this.db.readAppState(
                        `xtream-import-status:${playlist._id}:${type}`
                    );
                    if (!row) throw new Error('Could not read catalog status.');
                    priorStatuses.set(type, row.value);
                }
                markersStaged = true;
                for (const type of types)
                    await this.markUnfinished(playlist._id, type);
            }
            // Secure recovery before accepting metadata, but never replace a
            // catalog until the authoritative edit is accepted.
            const accepted = await beforeReplace?.();
            metadataAccepted = beforeReplace !== undefined;
            if (accepted && !sameXtreamCatalogConnection(playlist, accepted)) {
                acceptedConnectionChanged = true;
                throw new XtreamCatalogConnectionChangedError();
            }
            replacementStarted = true;
            if (markersStaged) types.forEach((type) => incomplete.add(type));
            const invalidated = await this.db.deleteXtreamPlaylistContent(
                playlist._id,
                {
                    contentTypes: types,
                }
            );
            if (!invalidated.success)
                throw new Error('Could not invalidate catalog cache.');
            // Unchanged connections acquire cleanup ownership after native
            // invalidation; accepted connection edits already own staged types.
            // Interrupted deletion keeps its idle status + pending recovery.
            for (const type of types) {
                incomplete.add(type);
                replaced.add(type);
            }
            for (const { type, categories, content } of catalogs) {
                // Deletion resets existing status keys to idle; re-arm before
                // any native batch can commit without renderer cleanup.
                await this.markUnfinished(playlist._id, type);
                const categoryType = type === 'movie' ? 'movies' : type;
                publish(type, 'saving-categories');
                await this.db.saveXtreamCategories(
                    playlist._id,
                    categories,
                    categoryType,
                    saved.hiddenCategories
                        .filter(
                            (category) => category.categoryType === categoryType
                        )
                        .map((category) => category.xtreamId),
                    this.locks.lockedXtreamIds(playlist._id, categoryType)
                );
                publish(type, 'saving-content', 0, content.length);
                const count = await this.db.saveXtreamContent(
                    playlist._id,
                    content,
                    type,
                    undefined,
                    {
                        onEvent: (event) => {
                            if (event.current !== undefined)
                                publish(
                                    type,
                                    'saving-content',
                                    event.current,
                                    event.total ?? content.length
                                );
                        },
                    }
                );
                if (content.length > 0 && count === 0)
                    throw new Error('Saving the refreshed catalog failed.');
                await this.commit.setState(
                    playlist,
                    `xtream-import-status:${playlist._id}:${type}`,
                    'completed'
                );
                incomplete.delete(type);
            }
            publish(null, 'restoring');
            const result = await this.pending.applyAndConsume(
                playlist._id,
                snapshot,
                async (state) => {
                    await this.db.restoreXtreamUserData(
                        playlist._id,
                        [],
                        state.recentlyViewed
                    );
                    await completeCatalogHistoryRecovery(
                        this.db,
                        this.deferred,
                        playlist._id,
                        prepared.snapshot,
                        available,
                        () =>
                            this.commit.setState(
                                playlist,
                                xtreamHistoryRecoveryKey(playlist._id),
                                ''
                            )
                    );
                }
            );
            if (result === 'consume-failed')
                throw new Error('Could not finish source restore.');
        } catch (error) {
            let rollbackSucceeded = false;
            if (
                markersStaged &&
                original &&
                (!metadataAccepted ||
                    (replacementStarted &&
                        !replaced.size &&
                        sameXtreamCatalogConnection(original, playlist)))
            ) {
                try {
                    await this.commit.assertCurrent(original);
                    if (metadataAccepted) {
                        // Native invalidation atomically resets every staged
                        // key to idle before deleting rows. Only importing on
                        // all keys proves the worker never passed that reset.
                        for (const type of types) {
                            const row = await this.db.readAppState(
                                `xtream-import-status:${playlist._id}:${type}`
                            );
                            if (row?.value !== 'importing')
                                throw new Error(
                                    'Catalog invalidation may have started.'
                                );
                        }
                    }
                    for (const [type, value] of priorStatuses) {
                        const key = `xtream-import-status:${playlist._id}:${type}`;
                        if (value === 'completed')
                            await this.commit.setState(original, key, value);
                        else if (!(await this.db.setAppState(key, value ?? '')))
                            throw new Error(
                                'Could not restore catalog status.'
                            );
                    }
                    rollbackSucceeded = true;
                    incomplete.clear();
                    replacementStarted = false;
                } catch {
                    // Unknown/changed connections cannot authorize rolling a
                    // marker back to completed. Keep recovery for the retry.
                    keepPreparedRecovery = true;
                }
            }
            let connectionChanged =
                !rollbackSucceeded &&
                (metadataAccepted || replacementStarted) &&
                error instanceof XtreamCatalogConnectionChangedError;
            if (!connectionChanged && replacementStarted) {
                try {
                    await this.commit.assertCurrent(playlist);
                } catch (checkError) {
                    connectionChanged =
                        checkError instanceof
                        XtreamCatalogConnectionChangedError;
                }
            }
            if (connectionChanged) {
                incomplete.clear();
                // Accepted metadata can enable retained caches from the old
                // endpoint before replacement starts. They also need retry.
                (acceptedConnectionChanged || !replaced.size
                    ? types
                    : replaced
                ).forEach((type) => incomplete.add(type));
            }
            if (
                !replacementStarted &&
                !acceptedConnectionChanged &&
                !keepPreparedRecovery &&
                snapshot &&
                this.pending.getSnapshotOrThrow(playlist._id)?.revision ===
                    snapshot.revision
            ) {
                if (historyPrepared)
                    await clearCatalogHistoryRecovery(this.db, playlist._id);
                if (!this.pending.clear(playlist._id, snapshot.state))
                    throw new Error('Could not cancel source recovery.');
            }
            // Native writes commit in chunks. A retry must not reuse a partial
            // catalog and then consume history for content it never imported.
            let cleanupFailed = false;
            for (const type of incomplete) {
                try {
                    try {
                        await this.db.setXtreamImportStatus(
                            playlist._id,
                            type,
                            'failed'
                        );
                    } finally {
                        if (
                            !(await this.db.clearXtreamImportCache(
                                playlist._id,
                                type
                            ))
                        )
                            cleanupFailed = true;
                    }
                } catch {
                    cleanupFailed = true;
                }
            }
            if (cleanupFailed)
                throw new Error('Could not clear incomplete catalog cache.');
            throw error;
        } finally {
            this.progressState.set(null);
            release();
        }
    }

    private async markUnfinished(
        playlistId: string,
        type: XtreamContentType
    ): Promise<void> {
        if (
            !(await this.db.setXtreamImportStatus(
                playlistId,
                type,
                'importing'
            ))
        )
            throw new Error('Could not retain unfinished catalog state.');
    }

    private async request<T>(
        playlist: PlaylistMeta,
        action: string
    ): Promise<T[]> {
        const response = await this.data.sendIpcEvent<{
            type?: string;
            payload?: unknown;
        }>(XTREAM_REQUEST, {
            url: normalizeXtreamServerUrl(playlist.serverUrl ?? ''),
            ...(playlist.userAgent?.trim()
                ? { userAgent: playlist.userAgent.trim() }
                : {}),
            params: {
                username: playlist.username?.trim(),
                password: playlist.password?.trim(),
                action,
            },
        });
        if (response?.type === 'ERROR' || !Array.isArray(response?.payload)) {
            throw new Error('The source did not return a valid catalog.');
        }
        return response.payload as T[];
    }
}
