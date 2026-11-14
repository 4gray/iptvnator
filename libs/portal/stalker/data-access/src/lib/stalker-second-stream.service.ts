import { inject, Injectable } from '@angular/core';
import { sourceSortName } from '@iptvnator/playlist/shared/util';
import {
    buildCollectionUid,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { DataService, ParentalLockService } from '@iptvnator/services';
import {
    isStalkerSeriesFlag,
    isStalkerSeriesItem,
    type PlayerContentInfo,
    type PlaylistMeta,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type {
    StalkerSeason,
    StalkerVodSeriesEpisode,
    StalkerVodSeriesSeason,
    StalkerVodSource,
} from './models';
import { StalkerEpisodeResolver } from './stalker-episode-resolver.service';
import { StalkerFavoritePlaybackResolver } from './stalker-favorite-playback.service';
import {
    buildStalkerExternalPlaybackHeaders,
    isCrossOriginStalkerStream,
} from './stalker-live-playback.utils';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import {
    loadStalkerSearchPage,
    type StalkerSearchContentType,
} from './stalker-search-page';
import {
    mapRegularSeriesEpisodes,
    mapRegularSeriesSeasons,
    mapVodSeriesEpisodes,
    mapVodSeriesSeasonsToVm,
    type StalkerMappedEpisode,
} from './stalker-series.adapters';
import { fetchStalkerSeriesPages } from './stalker-series-pagination';
import { StalkerSessionService } from './stalker-session.service';
import {
    createStalkerInfo,
    firstNonBlankStalkerIdText,
    normalizeStalkerEntityIdAsNumber,
} from './stalker-vod.utils';
import {
    executeStalkerRequest,
    fetchStalkerMovieFileId,
    fetchStalkerPlaybackLink,
    shouldResolveMovieFileId,
    sortByNumericValue,
    sortVodSeriesSeasonsByNumber,
} from './stores/utils';

export function stalkerSecondStreamType(
    item: UnifiedCollectionItem
): StalkerSearchContentType {
    const raw = item.stalkerItem as
        (StalkerVodSource & { favoriteContentType?: string }) | undefined;
    return item.contentType === 'series' &&
        (raw?.favoriteContentType === 'series' ||
            (raw?.favoriteContentType !== 'vod' &&
                !isStalkerSeriesItem(raw ?? {})))
        ? 'series'
        : 'vod';
}

@Injectable({ providedIn: 'root' })
export class StalkerSecondStreamService {
    private readonly session = inject(StalkerSessionService);
    private readonly deps = {
        dataService: inject(DataService),
        stalkerSession: this.session,
        portalRepair: inject(StalkerPortalRepairService),
    };
    private readonly locks = inject(ParentalLockService);
    private readonly favorites = inject(StalkerFavoritePlaybackResolver);
    private readonly episodeResolver = inject(StalkerEpisodeResolver);

    async browse(
        playlist: PlaylistMeta,
        type: 'movie' | 'series',
        search: string,
        page: number,
        signal: AbortSignal,
        seenPages: ReadonlySet<string>,
        exhaustedCatalogs: ReadonlySet<StalkerSearchContentType>
    ) {
        const scope = {
            ...playlist,
            portalUrl: playlist.portalUrl ?? playlist.url,
        };
        if (this.locks.withholdsEverything())
            return { items: [], hasMore: false };
        const catalogTypes =
            type === 'series'
                ? (['series', 'vod'] as const)
                : (['vod'] as const);
        const parts = await Promise.all(
            catalogTypes
                .filter((catalog) => !exhaustedCatalogs.has(catalog))
                .map(async (catalog) => {
                    const result = await loadStalkerSearchPage(
                        this.deps,
                        scope,
                        catalog,
                        search,
                        page,
                        { silent: true }
                    );
                    signal.throwIfAborted();
                    const pageKey = JSON.stringify([
                        catalog,
                        result.rawItems
                            .map((row) =>
                                firstNonBlankStalkerIdText(
                                    row.id,
                                    row.stream_id,
                                    row.movie_id,
                                    row.series_id,
                                    row.name,
                                    row.title
                                )
                            )
                            .sort(),
                    ]);
                    if (seenPages.has(pageKey))
                        return { items: [], hasMore: false, pageKey, catalog };
                    const items: UnifiedCollectionItem[] = [];
                    for (const row of result.rawItems) {
                        const isSeries =
                            catalog === 'series' || isStalkerSeriesItem(row);
                        const id = firstNonBlankStalkerIdText(
                            row.id,
                            row.stream_id,
                            row.movie_id,
                            row.series_id
                        );
                        const category = row.category_id;
                        if (
                            !id ||
                            isSeries !== (type === 'series') ||
                            this.locks.isStalkerCategoryLocked(
                                playlist._id,
                                catalog,
                                category
                            ) ||
                            (category == null &&
                                this.locks.active() &&
                                this.locks.lockedStalkerIds(
                                    playlist._id,
                                    catalog
                                ).length)
                        )
                            continue;
                        const info = createStalkerInfo(row);
                        items.push({
                            uid: buildCollectionUid(
                                'stalker',
                                playlist._id,
                                `${catalog}:${id}`
                            ),
                            name: info.name,
                            posterUrl: info.movie_image,
                            contentType: type,
                            sourceType: 'stalker',
                            playlistId: playlist._id,
                            playlistName: sourceSortName(playlist),
                            stalkerId: id,
                            categoryId: category,
                            stalkerItem: {
                                ...row,
                                id,
                                favoriteContentType: catalog,
                            },
                        });
                    }
                    // Portals choose the page size. Read until an empty page rather than assuming it is fixed.
                    return {
                        items,
                        pageKey,
                        catalog,
                        hasMore:
                            result.rawItems.length > 0 &&
                            (result.totalItems == null ||
                                result.rawItems.length <
                                    Number(result.totalItems)),
                    };
                })
        );
        signal.throwIfAborted();
        return {
            items: parts.reduce<UnifiedCollectionItem[]>(
                (items, part) => items.concat(part.items),
                []
            ),
            hasMore: parts.some((part) => part.hasMore),
            pageKeys: parts.map((part) => part.pageKey),
            exhaustedCatalogs: parts
                .filter((part) => !part.hasMore)
                .map((part) => part.catalog),
        };
    }

    async episodes(
        playlist: PlaylistMeta,
        item: UnifiedCollectionItem,
        signal: AbortSignal
    ) {
        const type = stalkerSecondStreamType(item);
        const original = item.stalkerItem as StalkerVodSource;
        const id = firstNonBlankStalkerIdText(item.stalkerId);
        const parentId = normalizeStalkerEntityIdAsNumber(id);
        if (!id) throw new Error('Stalker series unavailable');
        const params = { action: 'get_ordered_list', movie_id: id, type };
        if (type === 'vod' && isStalkerSeriesFlag(original?.is_series)) {
            const seasons =
                await fetchStalkerSeriesPages<StalkerVodSeriesSeason>(
                    (p) =>
                        executeStalkerRequest(
                            this.deps,
                            playlist,
                            { ...params, p },
                            { silent: true }
                        ),
                    () => !signal.aborted
                );
            const mapped = mapVodSeriesSeasonsToVm(
                sortVodSeriesSeasonsByNumber(
                    seasons.filter((season) => season.is_season === true)
                ),
                item.name,
                id
            );
            for (const season of mapped) {
                season.episodes = (
                    await fetchStalkerSeriesPages<StalkerVodSeriesEpisode>(
                        (p) =>
                            executeStalkerRequest(
                                this.deps,
                                playlist,
                                {
                                    ...params,
                                    movie_id: season.video_id,
                                    season_id: season.id,
                                    p,
                                },
                                { silent: true }
                            ),
                        () => !signal.aborted
                    )
                ).filter((episode) => episode.is_episode === true);
            }
            return mapVodSeriesEpisodes(mapped, {
                parentSeriesId: parentId ?? id,
                activityParentSeriesId: id,
                fallbackPoster: item.posterUrl ?? undefined,
            });
        }

        const embedded = type === 'vod';
        const rows = embedded
            ? []
            : await fetchStalkerSeriesPages<StalkerSeason>(
                  (p) =>
                      executeStalkerRequest(
                          this.deps,
                          playlist,
                          { ...params, p },
                          { silent: true }
                      ),
                  () => !signal.aborted
              );
        const series =
            embedded && !original?.series?.length
                ? await this.favorites.metadata(playlist, {
                      ...original,
                      info: original?.info ?? undefined,
                      is_series: original?.is_series ?? undefined,
                      id,
                      favoriteContentType: type,
                  })
                : original;
        signal.throwIfAborted();
        return mapRegularSeriesEpisodes(
            mapRegularSeriesSeasons(
                embedded ? series : null,
                sortByNumericValue(rows)
            ),
            item.posterUrl ?? undefined,
            item.name,
            id,
            embedded ? 'embedded' : 'regular'
        );
    }

    async resolve(
        playlist: PlaylistMeta,
        item: UnifiedCollectionItem,
        episode?: StalkerMappedEpisode
    ): Promise<ResolvedPortalPlayback> {
        const type = stalkerSecondStreamType(item);
        const source = item.stalkerItem as StalkerVodSource;
        const original = {
            ...source,
            info: source?.info ?? undefined,
            is_series: source?.is_series ?? undefined,
            id: item.stalkerId,
            favoriteContentType: type,
        };
        let cmd: string | undefined;
        let flags: StalkerVodSource | undefined;
        if (episode) {
            cmd = episode.vodEpisode
                ? await this.episodeResolver.resolveCommand(playlist, episode)
                : episode.originalCmd;
        } else {
            flags = (await this.favorites.resolve(
                playlist,
                original
            )) as StalkerVodSource;
            cmd = flags.cmd;
            if (cmd && shouldResolveMovieFileId(flags, cmd)) {
                const file = await fetchStalkerMovieFileId(
                    this.deps,
                    playlist,
                    firstNonBlankStalkerIdText(item.stalkerId)
                );
                if (file) cmd = `/media/file_${file}.mpg`;
            }
        }
        if (!cmd) throw new Error('Stalker stream unavailable');
        const streamUrl = await fetchStalkerPlaybackLink(this.deps, {
            playlist,
            selectedContentType: type,
            cmd,
            series: episode?.episode_num,
            linkFlags: flags,
        });
        const id = normalizeStalkerEntityIdAsNumber(item.stalkerId);
        const contentInfo: PlayerContentInfo | undefined =
            id == null
                ? undefined
                : {
                      playlistId: playlist._id,
                      contentType: episode ? 'episode' : 'vod',
                      contentXtreamId: episode ? Number(episode.id) : id,
                      seriesXtreamId: episode ? id : undefined,
                      seasonNumber: episode?.season,
                      episodeNumber: episode?.episode_num,
                      activityIdentity: episode?.activityIdentity,
                  };
        const headers = buildStalkerExternalPlaybackHeaders(
            playlist,
            this.session.getCachedToken(playlist._id),
            streamUrl
        );
        if (!isCrossOriginStalkerStream(playlist, streamUrl)) {
            const origin = playlist.origin?.trim();
            const referrer = playlist.referrer?.trim();
            if (origin) headers['Origin'] = origin;
            if (referrer) headers['Referer'] = referrer;
        }
        return {
            streamUrl,
            title: episode?.title || item.name,
            thumbnail: item.posterUrl,
            isLive: false,
            contentInfo,
            headers,
        };
    }
}
