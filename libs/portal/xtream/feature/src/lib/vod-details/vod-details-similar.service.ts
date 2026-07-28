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
import {
    normalizeTitleKeys,
    XtreamVodInfo,
} from '@iptvnator/shared/interfaces';
import {
    SimilarCatalogItem,
    matchRecommendationsToCatalog,
} from '../tmdb-similar.util';

/**
 * The "Similar" rail on the VOD details page.
 *
 * Two sources feed it: TMDB recommendations matched against the catalog this
 * playlist already loaded, and — in Electron — the same recommendations
 * matched across every OTHER imported playlist. The second list is filtered
 * against the first so one film does not appear twice under different portals.
 *
 * Component-provided: the cross-portal lookup is per-movie and its result must
 * die with the page rather than leak into the next film.
 */
@Injectable()
export class VodDetailsSimilarService {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly crossPortalSimilar = inject(CrossPortalSimilarService);

    private vodInfo: Signal<XtreamVodInfo | null> = signal(null);
    private routeContentId: Signal<number> = signal(NaN);

    bind(bindings: {
        vodInfo: Signal<XtreamVodInfo | null>;
        routeContentId: Signal<number>;
    }): void {
        this.vodInfo = bindings.vodInfo;
        this.routeContentId = bindings.routeContentId;
    }

    /** TMDB recommendations matched against the loaded VOD catalog. */
    readonly similarItems = computed<SimilarCatalogItem[]>(() => {
        const info = this.vodInfo();
        if (!info?.tmdb_recommendations?.length) {
            return [];
        }

        return matchRecommendationsToCatalog(
            info.tmdb_recommendations,
            this.xtreamStore.vodStreams(),
            { excludeId: this.routeContentId() }
        );
    });

    /** Recommendations found in the user's OTHER portals (Electron only). */
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
        const recommendations = this.vodInfo()?.tmdb_recommendations;
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
                .matchRecommendations(recommendations, 'movie', {
                    excludePlaylistId: playlistId,
                })
                .then((items) => {
                    // The user can open another film across the lookup, and
                    // the rail must not describe the one they left.
                    if (
                        this.vodInfo()?.tmdb_recommendations === recommendations
                    ) {
                        this.crossPortalItems.set(items);
                    }
                });
        });
    });
}
