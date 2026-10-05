import {
    type Signal,
    computed,
    effect,
    signal,
    untracked,
} from '@angular/core';
import type {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
} from '@iptvnator/services';
import type { NormalizedVodMeta } from '@iptvnator/shared/interfaces';

/**
 * TMDB recommendations found in the user's OTHER portals (batched DB
 * match, Electron only). Loaded async — the section appears when
 * resolved; staleness-guarded against item changes in flight.
 *
 * Registers the loading effect, so call it from a field initializer
 * (injection context).
 */
export function createVodSimilarInPortals(
    normalizedMeta: Signal<NormalizedVodMeta>,
    crossPortalSimilar: CrossPortalSimilarService
): Signal<CrossPortalSimilarItem[]> {
    const matched = signal<CrossPortalSimilarItem[]>([]);
    /** Filtered on read: a relock hides matches cached while unlocked. */
    const visible = computed(() => crossPortalSimilar.visible(matched()));

    effect(() => {
        const meta = normalizedMeta();
        const recommendations = meta.tmdbRecommendations;
        untracked(() => {
            matched.set([]);
            if (!recommendations?.length || !crossPortalSimilar.isAvailable) {
                return;
            }
            void crossPortalSimilar
                .matchRecommendations(recommendations, 'movie')
                .then((items) => {
                    if (
                        normalizedMeta().tmdbRecommendations === recommendations
                    ) {
                        matched.set(items);
                    }
                });
        });
    });

    return visible;
}
