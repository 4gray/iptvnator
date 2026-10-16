import { inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
    createDiscoverFacetNavigation,
    type DiscoverFacetNavigation,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import type { TmdbEnrichedCastMember } from '@iptvnator/shared/interfaces';
import type { SimilarCatalogItem } from './tmdb-similar.util';

/** Where an Xtream movie or series details page can send the viewer. */
export interface XtreamDetailNavigation {
    /** Clickable year/genre/country chips (Discover pages) */
    readonly discover: DiscoverFacetNavigation;
    /** The actor page of a TMDB-matched cast member. */
    openActor(member: TmdbEnrichedCastMember): void;
    /** A Similar-rail title of this playlist: the same route, another id. */
    openSimilar(item: SimilarCatalogItem): void;
    /** A Similar-rail title found in another of the user's portals. */
    openSimilarInPortals(item: CrossPortalSimilarItem): void;
}

/**
 * Outbound navigation shared by the Xtream movie (`movie`) and series (`tv`)
 * details pages.
 *
 * Must run in an injection context.
 */
export function injectXtreamDetailNavigation(
    mediaType: 'movie' | 'tv'
): XtreamDetailNavigation {
    const router = inject(Router);
    const route = inject(ActivatedRoute);
    const xtreamStore = inject(XtreamStore);
    const crossPortalSimilar = inject(CrossPortalSimilarService);
    const tmdbEnrichment = inject(TmdbEnrichmentService);

    return {
        discover: createDiscoverFacetNavigation(() => {
            const playlistId = xtreamStore.currentPlaylist()?.id;
            // Discover reads its results from TMDB, so a chip must not offer a
            // page that enrichment cannot fill
            return playlistId && tmdbEnrichment.isEnabled()
                ? { portal: 'xtream', mediaType, playlistId }
                : null;
        }),
        openActor(member) {
            const playlistId = xtreamStore.currentPlaylist()?.id;
            if (!playlistId || !member.tmdbPersonId) {
                return;
            }
            void router.navigate([
                '/workspace/xtreams',
                playlistId,
                'actor',
                member.tmdbPersonId,
            ]);
        },
        openSimilar(item) {
            void router.navigate(['../..', item.categoryId, item.id], {
                relativeTo: route,
            });
        },
        openSimilarInPortals(item) {
            void router.navigate(crossPortalSimilar.buildLink(item));
        },
    };
}
