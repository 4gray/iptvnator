import { inject, Injectable } from '@angular/core';
import type {
    CollectionContentType,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { isStalkerSeriesItem } from '@iptvnator/shared/interfaces';
import { UnifiedFavoritesDataService } from './collection/unified-favorites-data.service';
import { UnifiedRecentDataService } from './collection/unified-recent-data.service';

export const SECOND_STREAM_HISTORY = 'recently-viewed';

@Injectable({ providedIn: 'root' })
export class SecondStreamCollectionService {
    private readonly favorites = inject(UnifiedFavoritesDataService);
    private readonly recent = inject(UnifiedRecentDataService);
    private readonly xtream = inject(XTREAM_DATA_SOURCE);
    private readonly runtime = inject(RuntimeCapabilitiesService);

    async load(
        scope: string,
        type: CollectionContentType,
        signal: AbortSignal
    ) {
        const rows =
            scope === SECOND_STREAM_HISTORY
                ? await this.recent.getRecentItems('all')
                : await this.favorites.getFavorites('all');
        signal.throwIfAborted();
        const items: UnifiedCollectionItem[] = [];
        for (const row of rows) {
            const contentType =
                row.sourceType === 'stalker' &&
                row.contentType === 'movie' &&
                isStalkerSeriesItem(
                    row.stalkerItem as Parameters<typeof isStalkerSeriesItem>[0]
                )
                    ? 'series'
                    : row.contentType;
            if (contentType === type && row.radio !== 'true') {
                items.push(
                    contentType === row.contentType
                        ? row
                        : { ...row, contentType }
                );
            }
        }
        if (!this.runtime.supportsXtreamSqliteDataSource) return items;
        const ids = new Set(
            items
                .filter((item) => item.sourceType === 'xtream')
                .map((item) => item.playlistId)
        );
        const categories = new Map(
            await Promise.all(
                [...ids].map(
                    async (id) =>
                        [
                            id,
                            new Map(
                                (
                                    await this.xtream.getAllCategories(
                                        id,
                                        type === 'movie' ? 'movies' : type
                                    )
                                ).map((category) => [
                                    String(category.id),
                                    category,
                                ])
                            ),
                        ] as const
                )
            )
        );
        signal.throwIfAborted();
        const normalized: UnifiedCollectionItem[] = [];
        for (const item of items) {
            if (item.sourceType !== 'xtream') {
                normalized.push(item);
                continue;
            }
            const category = categories
                .get(item.playlistId)
                ?.get(String(item.categoryId));
            if (!category?.hidden)
                normalized.push({ ...item, categoryId: category?.xtream_id });
        }
        return normalized;
    }
}
