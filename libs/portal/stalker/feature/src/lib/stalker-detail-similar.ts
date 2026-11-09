import { Location } from '@angular/common';
import {
    Injectable,
    Injector,
    computed,
    inject,
    resource,
    signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
    buildStalkerDetailNavigationTarget,
    stalkerHandoffIdentityOf,
    STALKER_RETURN_BY_HISTORY_STATE_KEY,
    STALKER_SIMILAR_FRAGMENT,
    STALKER_SIMILAR_ORIGIN,
    type StalkerSimilarOrigin,
} from '@iptvnator/portal/shared/util';
import {
    buildStalkerSelectedVodItem,
    normalizeStalkerEntityId,
    StalkerSimilarService,
    type StalkerSearchContentType,
    type StalkerSimilarMatch,
    type StalkerVodSource,
} from '@iptvnator/portal/stalker/data-access';
import {
    ParentalLockService,
    PlaylistsService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { isStalkerSeriesItem } from '@iptvnator/shared/interfaces';
import {
    DETAIL_SIMILAR_SOURCE,
    type SimilarRailItem,
} from '@iptvnator/ui/components';
import { firstValueFrom } from 'rxjs';

interface SimilarDetailBindings {
    item: () => StalkerVodSource | null;
    catalog: () => StalkerSearchContentType | null;
    playlistId: () => string | null | undefined;
    enabled: () => boolean;
    origin?: (item: StalkerSimilarOrigin) => StalkerSimilarOrigin | null;
}

@Injectable()
export class StalkerDetailSimilar {
    private readonly injector = inject(Injector);
    private readonly bindings = signal<SimilarDetailBindings | null>(null);

    bind(bindings: SimilarDetailBindings): void {
        this.bindings.set(bindings);
    }

    private readonly query = computed(
        () => {
            const bindings = this.bindings();
            const item = bindings?.item();
            const recommendations = item?.info?.tmdb_recommendations;
            if (
                !bindings ||
                !item ||
                !recommendations?.length ||
                !bindings.enabled() ||
                !this.injector.get(TmdbEnrichmentService).isEnabled()
            ) {
                return undefined;
            }
            const playlistId = bindings.playlistId();
            const catalog = bindings.catalog();
            const id = normalizeStalkerEntityId(item.id ?? item.stream_id);
            if (!playlistId || !catalog || !id) return undefined;
            const mediaType =
                catalog === 'series' || isStalkerSeriesItem(item)
                    ? 'tv'
                    : 'movie';
            return {
                playlistId,
                subject: { catalog, id, mediaType, tmdbId: item.info?.tmdb_id },
                recommendations,
            } as const;
        },
        {
            equal: (a, b) =>
                a?.recommendations === b?.recommendations &&
                a?.playlistId === b?.playlistId &&
                a?.subject.catalog === b?.subject.catalog &&
                a?.subject.id === b?.subject.id &&
                a?.subject.mediaType === b?.subject.mediaType &&
                a?.subject.tmdbId === b?.subject.tmdbId,
        }
    );

    private readonly results = resource({
        params: this.query,
        loader: async ({ params, abortSignal }) => {
            try {
                const playlist = await firstValueFrom(
                    this.injector
                        .get(PlaylistsService)
                        .getPlaylistById(params.playlistId)
                );
                if (
                    !playlist?.portalUrl ||
                    !playlist.macAddress ||
                    abortSignal.aborted
                )
                    return null;
                const matches = await this.injector
                    .get(StalkerSimilarService)
                    .match(
                        playlist,
                        params.subject,
                        params.recommendations,
                        abortSignal
                    );
                return { query: params, matches };
            } catch {
                return null;
            }
        },
        defaultValue: null,
    });

    private readonly visible = computed(() => {
        const query = this.query();
        const results = this.results.value();
        if (!query || results?.query !== query) return [];
        const lock = this.injector.get(ParentalLockService);
        return results.matches.filter(
            ({ catalog, item }) =>
                !lock.isStalkerCategoryLocked(
                    query.playlistId,
                    catalog,
                    item.category_id
                )
        );
    });

    readonly items = computed<SimilarRailItem[]>(() => {
        const query = this.query();
        return query
            ? this.visible().map((match) => ({
                  key: cardKey(query.playlistId, match),
                  title: match.recommendation.title,
                  year: match.recommendation.year,
                  posterUrl:
                      match.recommendation.posterUrl ??
                      match.item.info?.movie_image ??
                      null,
              }))
            : [];
    });

    open(card: SimilarRailItem): void {
        const query = this.query();
        if (!query) return;
        const match = this.visible().find(
            (item) => cardKey(query.playlistId, item) === card.key
        );
        if (!match) return;

        const router = this.injector.get(Router);
        const item = { ...buildStalkerSelectedVodItem(match.item) };
        const target = buildStalkerDetailNavigationTarget({
            playlistId: query.playlistId,
            type: match.catalog === 'series' ? 'series' : 'movie',
            categoryId: match.item.category_id,
            item,
            returnTo: router.url,
        });
        this.rememberOrigin();
        // Stalker keeps details inline. A distinct history entry is needed even
        // when both items live under the very same category URL.
        const lastNavigation = router.lastSuccessfulNavigation();
        const fragment = STALKER_SIMILAR_FRAGMENT + (lastNavigation?.id ?? 0);
        void router.navigate(target.link, {
            fragment:
                fragment === lastNavigation?.finalUrl?.fragment
                    ? fragment + '-next'
                    : fragment,
            state: {
                ...target.state,
                [STALKER_RETURN_BY_HISTORY_STATE_KEY]:
                    stalkerHandoffIdentityOf(item),
            },
        });
    }

    rememberOrigin(): void {
        const query = this.query();
        const bindings = this.bindings();
        const item = bindings?.item();
        if (!query || !item) return;
        const origin = bindings?.origin?.({
            playlistId: query.playlistId,
            catalog: query.subject.catalog,
            item: { ...item },
        });
        if (!origin) return;
        this.injector
            .get(Location)
            .replaceState(this.injector.get(Router).url, '', {
                ...window.history.state,
                [STALKER_SIMILAR_ORIGIN]: origin,
            });
    }
}

function cardKey(playlistId: string, match: StalkerSimilarMatch): string {
    return JSON.stringify([
        'stalker',
        playlistId,
        match.catalog,
        match.item.id,
        match.recommendation.tmdbId,
    ]);
}

export const STALKER_DETAIL_SIMILAR_PROVIDERS = [
    StalkerDetailSimilar,
    { provide: DETAIL_SIMILAR_SOURCE, useExisting: StalkerDetailSimilar },
];
