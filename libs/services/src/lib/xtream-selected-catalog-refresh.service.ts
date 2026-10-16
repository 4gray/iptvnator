import { inject, Injectable } from '@angular/core';
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

const actions = {
    live: ['get_live_categories', 'get_live_streams'],
    movie: ['get_vod_categories', 'get_vod_streams'],
    series: ['get_series_categories', 'get_series'],
} as const;

/** Desktop edit-time refresh. Unchanged/disabled catalogs are never requested or deleted. */
@Injectable({ providedIn: 'root' })
export class XtreamSelectedCatalogRefreshService {
    private readonly data = inject(DataService);
    private readonly db = inject(DatabaseService);
    private readonly locks = inject(ParentalLockService);
    private readonly positions = inject(PlaybackPositionService);
    private readonly pending = inject(XtreamPendingRestoreService);
    private readonly activity = inject(SourceActivityService);

    async refresh(
        playlist: PlaylistMeta,
        types: XtreamContentType[]
    ): Promise<void> {
        if (!types.length) return;
        if (
            this.activity.isBusy(playlist._id) ||
            this.pending.getOrThrow(playlist._id)
        ) {
            throw new Error(
                'Finish or retry the current source import before changing the loaded catalogs.'
            );
        }
        const release = this.activity.begin([playlist._id]);
        try {
            // Fetch before deleting any cache. A provider failure leaves the saved catalog intact.
            const catalogs = [];
            for (const type of types) {
                const categories = await this.request<XtreamCategory>(
                    playlist,
                    actions[type][0]
                );
                const content = await this.request<Record<string, unknown>>(
                    playlist,
                    actions[type][1]
                );
                catalogs.push({ type, categories, content });
            }
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
            const saved: XtreamPendingRestoreState = {
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
            if (!this.pending.set(playlist._id, saved)) {
                throw new Error('Could not retain source restore state.');
            }
            const snapshot = this.pending.getSnapshotOrThrow(playlist._id);
            if (!snapshot)
                throw new Error('Source restore state is unavailable.');
            await this.db.deleteXtreamPlaylistContent(playlist._id, {
                contentTypes: types,
            });
            for (const { type, categories, content } of catalogs) {
                const categoryType = type === 'movie' ? 'movies' : type;
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
                const count = await this.db.saveXtreamContent(
                    playlist._id,
                    content,
                    type
                );
                if (content.length > 0 && count === 0)
                    throw new Error('Saving the refreshed catalog failed.');
                await this.db.setXtreamImportStatus(
                    playlist._id,
                    type,
                    'completed'
                );
            }
            const result = await this.pending.applyAndConsume(
                playlist._id,
                snapshot,
                async (state) => {
                    await this.db.restoreXtreamUserData(
                        playlist._id,
                        [],
                        state.recentlyViewed
                    );
                }
            );
            if (result === 'consume-failed')
                throw new Error('Could not finish source restore.');
        } finally {
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
