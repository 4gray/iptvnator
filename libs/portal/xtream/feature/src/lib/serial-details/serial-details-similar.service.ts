import {
    Injectable,
    Signal,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
} from '@iptvnator/services';
import { normalizeTitleKeys } from '@iptvnator/shared/interfaces';
import {
    SimilarCatalogItem,
    matchRecommendationsToCatalog,
} from '../tmdb-similar.util';
import type { XtreamSerieDetailsView } from './serial-details-playback.service';

/**
 * The "Similar" rail on the series details page — the series counterpart of
 * {@link VodDetailsSimilarService}, with the same two sources: TMDB
 * recommendations matched against this playlist's loaded catalog, and — in
 * Electron — the same recommendations matched across every OTHER imported
 * playlist, filtered against the first list so one show cannot appear twice.
 *
 * Component-provided: the cross-portal lookup is per-series and must die with
 * the page rather than leak into the next show.
 */
@Injectable()
export class SerialDetailsSimilarService {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly crossPortalSimilar = inject(CrossPortalSimilarService);

    private selectedItem: Signal<XtreamSerieDetailsView | null> = signal(null);

    bind(bindings: {
        selectedItem: Signal<XtreamSerieDetailsView | null>;
    }): void {
        this.selectedItem = bindings.selectedItem;
    }

    readonly similarItems = computed<SimilarCatalogItem[]>(() => {
        const item = this.selectedItem();
        const recommendations = item?.info?.tmdb_recommendations;
        if (!recommendations?.length) {
            return [];
        }
        return matchRecommendationsToCatalog(
            recommendations,
            this.xtreamStore.serialStreams(),
            { excludeId: Number(item?.series_id) }
        );
    });

    /** Recommendations found in the user's OTHER portals (Electron only) */
    private readonly crossPortalItems = signal<CrossPortalSimilarItem[]>([]);

    readonly similarInPortals = computed<CrossPortalSimilarItem[]>(() => {
        const localTitles = new Set(
            this.similarItems().map(
                (item) => normalizeTitleKeys(item.title).exact
            )
        );
        return this.crossPortalItems().filter(
            (item) => !localTitles.has(normalizeTitleKeys(item.title).exact)
        );
    });

    private readonly loadCrossPortalSimilar = effect(() => {
        const recommendations = this.selectedItem()?.info?.tmdb_recommendations;
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        untracked(() => {
            this.crossPortalItems.set([]);
            if (
                !recommendations?.length ||
                !this.crossPortalSimilar.isAvailable
            ) {
                return;
            }
            void this.crossPortalSimilar
                .matchRecommendations(recommendations, 'series', {
                    excludePlaylistId: playlistId,
                })
                .then((items) => {
                    // Staleness guard: a slow lookup for the previous series
                    // must not populate the rail of the one now on screen
                    if (
                        this.selectedItem()?.info?.tmdb_recommendations ===
                        recommendations
                    ) {
                        this.crossPortalItems.set(items);
                    }
                });
        });
    });
}
