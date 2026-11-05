import { inject, Injector } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
    createDiscoverFacetNavigation,
    type DiscoverFacetNavigation,
    workspacePortalCommands,
} from '@iptvnator/portal/shared/util';
import { WorkspaceBackNavigationService } from '@iptvnator/portal/shared/data-access';
import {
    XTREAM_DATA_SOURCE,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
    RuntimeCapabilitiesService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import type { TmdbEnrichedCastMember } from '@iptvnator/shared/interfaces';
import type { SimilarCatalogItem } from './tmdb-similar.util';

/** Where an Xtream movie or series details page can send the viewer. */
export interface XtreamDetailNavigation {
    /** History Back, or the owning catalog when this detail opened the session. */
    back(): void;
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
    const backNavigation = inject(WorkspaceBackNavigationService);
    const injector = inject(Injector);
    const runtime = inject(RuntimeCapabilitiesService);
    const xtreamStore = inject(XtreamStore);
    const crossPortalSimilar = inject(CrossPortalSimilarService);
    const tmdbEnrichment = inject(TmdbEnrichmentService);

    return {
        back() {
            backNavigation.back(async () => {
                const parent = workspacePortalCommands(
                    route,
                    'xtreams',
                    mediaType === 'movie' ? 'vod' : 'series'
                );
                if (!parent) return null;
                let categoryId = route.snapshot.params['categoryId'];
                if (runtime.supportsXtreamSqliteDataSource) {
                    // Similar links can carry provider category IDs. The owning
                    // typed content row disambiguates them from SQLite row IDs.
                    categoryId = undefined;
                    const itemId = Number(
                        route.snapshot.params[
                            mediaType === 'movie' ? 'vodId' : 'serialId'
                        ]
                    );
                    if (Number.isFinite(itemId) && itemId > 0) {
                        try {
                            const dataSource = injector.get(XTREAM_DATA_SOURCE);
                            const contentType =
                                mediaType === 'movie' ? 'movie' : 'series';
                            const routeCategoryId = Number(
                                route.snapshot.params['categoryId']
                            );
                            // A typed provider ID may occur in several categories.
                            // Preserve the route's category only after proving membership.
                            const routeItem =
                                Number.isSafeInteger(routeCategoryId) &&
                                routeCategoryId > 0
                                    ? await dataSource.getContentByXtreamId(
                                          itemId,
                                          parent[2],
                                          contentType,
                                          undefined,
                                          routeCategoryId
                                      )
                                    : null;
                            const item =
                                routeItem ??
                                (await dataSource.getContentByXtreamId(
                                    itemId,
                                    parent[2],
                                    contentType
                                ));
                            categoryId = item?.category_id;
                        } catch {
                            // An unavailable row still has a safe catalog root.
                        }
                    }
                }
                if (categoryId) parent.push(String(categoryId));
                return router.serializeUrl(
                    router.createUrlTree(parent, {
                        queryParams: route.snapshot.queryParams,
                    })
                );
            });
        },
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
