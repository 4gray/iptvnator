import { inject, Injectable } from '@angular/core';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { DatabaseService } from './database-electron.service';
import { ParentalLockService } from './parental-lock';
import { SourceActivityService } from './source-activity.service';
import {
    matchesXtreamStartupSource,
    XtreamCatalogCommitService,
} from './xtream-catalog-commit.service';
import { XtreamCatalogFetchService } from './xtream-catalog-fetch.service';
import { XtreamSelectedCatalogRefreshService } from './xtream-selected-catalog-refresh.service';

function hasUsableStreamId(value: unknown): boolean {
    const id =
        typeof value === 'string' && /^\d+$/.test(value.trim())
            ? Number(value)
            : value;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
}

@Injectable({ providedIn: 'root' })
export class XtreamStartupRefreshService {
    private readonly db = inject(DatabaseService);
    private readonly commit = inject(XtreamCatalogCommitService);
    private readonly fetcher = inject(XtreamCatalogFetchService);
    private readonly refresh = inject(XtreamSelectedCatalogRefreshService);
    private readonly activity = inject(SourceActivityService);
    private readonly locks = inject(ParentalLockService);
    private readonly publishedUpdates = new Map<string, number>();

    private readonly removedLiveCategories = new Map<string, Set<number>>();

    recordUpdate(playlistId: string, updateDate: number): void {
        this.publishedUpdates.set(playlistId, updateDate);
    }

    matchesUpdate(playlistId: string, updateDate: number): boolean {
        return this.publishedUpdates.get(playlistId) === updateDate;
    }

    wasLiveCategoryRemoved(
        playlistId: string,
        updateDate: number,
        localId: number
    ): boolean {
        return (
            this.matchesUpdate(playlistId, updateDate) &&
            (this.removedLiveCategories.get(playlistId)?.has(localId) ?? false)
        );
    }

    async refreshLive(playlist: PlaylistMeta): Promise<boolean> {
        await this.locks.initialize();
        if (!this.locks.locksReadable()) {
            throw new Error('Could not read parental locks for the refresh.');
        }

        // Keep the saved catalog available while the provider responds.
        const current = await this.commit.readCurrentOrNull(playlist._id);
        if (!matchesXtreamStartupSource(playlist, current)) return false;
        const categories = await this.fetcher.categories(current, 'live');
        const contentSource = await this.commit.readCurrentOrNull(playlist._id);
        if (!matchesXtreamStartupSource(playlist, contentSource)) return false;
        const content = await this.fetcher.content(contentSource, 'live');
        const categoryIds = new Set(
            categories.map((category) =>
                Number.parseInt(String(category?.category_id), 10)
            )
        );
        if (
            categoryIds.has(NaN) ||
            categories.some(
                (category) => typeof category?.category_name !== 'string'
            ) ||
            content.length === 0 ||
            content.some(
                (stream) =>
                    !hasUsableStreamId(stream?.['stream_id']) ||
                    !categoryIds.has(
                        Number.parseInt(String(stream['category_id']))
                    )
            )
        ) {
            throw new Error('The source did not return a usable live catalog.');
        }

        // A route can finish loading its saved channels during the fetch.
        // Let it finish reading before the shared replacement takes its hold.
        while (this.activity.isBusy(playlist._id) || this.refresh.progress()) {
            await new Promise<void>((resolve) => {
                const unsubscribe = this.activity.onRelease(() => {
                    unsubscribe();
                    resolve();
                });
            });
        }
        const removed = new Set<number>();
        const refreshed = await this.refresh.refreshLiveOnStartup(
            playlist,
            { type: 'live', categories, content },
            async () => {
                const rows = await this.db.getAllXtreamCategories(
                    playlist._id,
                    'live'
                );
                const retained: [number, number][] = [];
                for (const row of rows) {
                    if (categoryIds.has(row.xtream_id)) {
                        retained.push([row.xtream_id, row.id]);
                    } else {
                        removed.add(row.id);
                    }
                }
                return retained;
            }
        );
        if (refreshed) {
            this.removedLiveCategories.set(playlist._id, removed);
            this.activity.notifyLiveCatalogReplacement(playlist._id);
        }
        return refreshed;
    }
}
