import { inject, Injectable } from '@angular/core';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { ParentalLockService } from './parental-lock';
import { SourceActivityService } from './source-activity.service';
import { XtreamCatalogFetchService } from './xtream-catalog-fetch.service';
import { XtreamSelectedCatalogRefreshService } from './xtream-selected-catalog-refresh.service';

@Injectable({ providedIn: 'root' })
export class XtreamStartupRefreshService {
    private readonly fetcher = inject(XtreamCatalogFetchService);
    private readonly refresh = inject(XtreamSelectedCatalogRefreshService);
    private readonly activity = inject(SourceActivityService);
    private readonly locks = inject(ParentalLockService);
    private readonly publishedUpdates = new Map<string, number>();

    recordUpdate(playlistId: string, updateDate: number): void {
        this.publishedUpdates.set(playlistId, updateDate);
    }

    matchesUpdate(playlistId: string, updateDate: number): boolean {
        return this.publishedUpdates.get(playlistId) === updateDate;
    }

    async refreshLive(playlist: PlaylistMeta): Promise<boolean> {
        await this.locks.initialize();
        if (!this.locks.locksReadable()) {
            throw new Error('Could not read parental locks for the refresh.');
        }

        // Keep the saved catalog available while the provider responds.
        const categories = await this.fetcher.categories(playlist, 'live');
        const content = await this.fetcher.content(playlist, 'live');
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
            content.some((stream) => !stream || typeof stream !== 'object') ||
            !content.some((stream) =>
                categoryIds.has(Number.parseInt(String(stream.category_id), 10))
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
        return this.refresh.refreshLiveOnStartup(playlist, {
            type: 'live',
            categories,
            content,
        });
    }
}
