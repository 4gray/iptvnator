import { inject, Injectable } from '@angular/core';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { DatabaseService } from './database-electron.service';
import { ParentalLockService } from './parental-lock';
import { SourceActivityService } from './source-activity.service';
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
    private readonly fetcher = inject(XtreamCatalogFetchService);
    private readonly refresh = inject(XtreamSelectedCatalogRefreshService);
    private readonly activity = inject(SourceActivityService);
    private readonly locks = inject(ParentalLockService);
    private readonly publishedUpdates = new Map<string, number>();

    private readonly previousLiveCategories = new Map<
        string,
        Map<number, number>
    >();

    recordUpdate(playlistId: string, updateDate: number): void {
        this.publishedUpdates.set(playlistId, updateDate);
    }

    matchesUpdate(playlistId: string, updateDate: number): boolean {
        return this.publishedUpdates.get(playlistId) === updateDate;
    }

    async resolvePreviousCategory(
        playlistId: string,
        updateDate: number,
        localId: number
    ): Promise<number | null | undefined> {
        if (!this.matchesUpdate(playlistId, updateDate)) return undefined;
        const providerId = this.previousLiveCategories
            .get(playlistId)
            ?.get(localId);
        if (providerId === undefined) return undefined;
        const categories = await this.db.getAllXtreamCategories(
            playlistId,
            'live'
        );
        return (
            categories.find((row) => row.xtream_id === providerId)?.id ?? null
        );
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
            content.some(
                (stream) => !hasUsableStreamId(stream?.['stream_id'])
            ) ||
            !content.some((stream) =>
                categoryIds.has(
                    Number.parseInt(String(stream['category_id']), 10)
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
        const previous = new Map<number, number>();
        const refreshed = await this.refresh.refreshLiveOnStartup(
            playlist,
            { type: 'live', categories, content },
            async () => {
                const rows = await this.db.getAllXtreamCategories(
                    playlist._id,
                    'live'
                );
                for (const row of rows) previous.set(row.id, row.xtream_id);
            }
        );
        if (refreshed) this.previousLiveCategories.set(playlist._id, previous);
        return refreshed;
    }
}
