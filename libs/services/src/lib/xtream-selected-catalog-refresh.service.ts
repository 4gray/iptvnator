import { inject, Injectable, signal } from '@angular/core';
import {
    normalizeXtreamServerUrl,
    PlaylistMeta,
    XtreamCategory,
    XtreamContentType,
    XTREAM_REQUEST,
    XTREAM_CONTENT_TYPES,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';
import { DataService } from './data.service';
import { DatabaseService, XCategoryFromDb } from './database-electron.service';
import { ParentalLockService } from './parental-lock';
import { PlaybackPositionService } from './playback-position.service';
import { SourceActivityService } from './source-activity.service';
import { XtreamPendingRestoreService } from './xtream-pending-restore.service';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';

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
    private readonly positions = inject(PlaybackPositionService);
    private readonly pending = inject(XtreamPendingRestoreService);
    private readonly deferred = inject(XtreamDeferredCatalogRestoreService);
    private readonly activity = inject(SourceActivityService);
    private readonly progressState =
        signal<XtreamSelectedCatalogProgress | null>(null);
    readonly progress = this.progressState.asReadonly();

    async refresh(
        playlist: PlaylistMeta,
        types: XtreamContentType[],
        beforeReplace?: () => Promise<void>
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
            // Rejected metadata edits must leave the old catalog and user state intact.
            await beforeReplace?.();
            publish(null, 'preparing');
            // Park user state BEFORE deletion so storage failure cannot erase history.
            const [playbackPositions, recent, categoriesByType] =
                await Promise.all([
                    this.positions.getAllPlaybackPositionsOrThrow(playlist._id),
                    this.db.getRecentItemsOrThrow(playlist._id),
                    Promise.all(
                        (['live', 'movies', 'series'] as const).map((type) =>
                            this.db.getAllXtreamCategories(playlist._id, type)
                        )
                    ),
                ]);
            let saved: XtreamPendingRestoreState = {
                favorites: [],
                playbackPositions,
                hiddenCategories: ([] as XCategoryFromDb[])
                    .concat(...categoriesByType)
                    .filter((category) => category.hidden)
                    .map((category) => ({
                        categoryType: category.type,
                        xtreamId: category.xtream_id,
                    })),
                recentlyViewed: recent
                    .filter((item) =>
                        XTREAM_CONTENT_TYPES.some((type) => type === item.type)
                    )
                    .map((item) => ({
                        contentType: item.type as XtreamContentType,
                        xtreamId: item.xtream_id,
                        viewedAt: item.viewed_at ?? new Date().toISOString(),
                    })),
            };
            // Replay dormant state only for catalogs fetched by this refresh.
            // All current SQLite snapshot rows already have retained identities.
            const available = types;
            const prepared = this.deferred.prepare(
                playlist._id,
                saved,
                available,
                true
            );
            saved = prepared.state;
            if (!this.pending.set(playlist._id, saved)) {
                throw new Error('Could not retain source restore state.');
            }
            const snapshot = this.pending.getSnapshotOrThrow(playlist._id);
            if (!snapshot)
                throw new Error('Source restore state is unavailable.');
            for (const type of types) incomplete.add(type);
            await this.db.deleteXtreamPlaylistContent(playlist._id, {
                contentTypes: types,
            });
            for (const { type, categories, content } of catalogs) {
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
                await this.db.setXtreamImportStatus(
                    playlist._id,
                    type,
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
                    this.deferred.complete(
                        playlist._id,
                        prepared.snapshot,
                        available
                    );
                }
            );
            if (result === 'consume-failed')
                throw new Error('Could not finish source restore.');
        } catch (error) {
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
