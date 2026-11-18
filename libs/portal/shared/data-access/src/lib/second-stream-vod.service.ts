import { inject, Injectable } from '@angular/core';
import { sourceSortName } from '@iptvnator/playlist/shared/util';
import {
    isPortalPlaybackWatched,
    buildXtreamCollectionUid,
    PORTAL_PLAYBACK_POSITIONS,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    XTREAM_DATA_SOURCE,
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    StalkerSecondStreamService,
    type StalkerSearchContentType,
    normalizeStalkerEntityIdAsNumber,
    reconcileStalkerSeriesPositions,
} from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import type {
    PlayerContentInfo,
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import {
    SECOND_STREAM_HISTORY,
    SecondStreamCollectionService,
} from './second-stream-collection.service';
import { VodSourceResolverService } from './multi-source/vod-source-resolver.service';
import {
    SecondStreamCatalogService,
    type SecondStreamSelection,
} from './second-stream-catalog.service';

export type SecondStreamVodType = 'movie' | 'series';

export interface SecondStreamVodPage {
    items: UnifiedCollectionItem[];
    hasMore: boolean;
    pageKeys?: string[];
    exhaustedCatalogs?: StalkerSearchContentType[];
}

export interface SecondStreamEpisode {
    readonly episode: XtreamSerieEpisode;
    readonly season: number;
    readonly position: PlaybackPositionData | null;
}

@Injectable({ providedIn: 'root' })
export class SecondStreamVodService {
    private readonly collection = inject(SecondStreamCollectionService);
    private readonly stalker = inject(StalkerSecondStreamService);
    private readonly catalog = inject(SecondStreamCatalogService);
    private readonly xtream = inject(XTREAM_DATA_SOURCE);
    private readonly playlists = inject(PlaylistsService);
    private readonly api = inject(XtreamApiService);
    private readonly urls = inject(XtreamUrlService);
    private readonly vod = inject(VodSourceResolverService);
    private readonly positions = inject(PORTAL_PLAYBACK_POSITIONS);

    async browse(
        playlistId: string,
        type: SecondStreamVodType,
        signal: AbortSignal,
        search: string,
        page: number,
        seenPages: ReadonlySet<string>,
        exhaustedCatalogs: ReadonlySet<StalkerSearchContentType>
    ): Promise<SecondStreamVodPage> {
        if (!playlistId || playlistId === SECOND_STREAM_HISTORY) {
            const items = await this.collection.load(playlistId, type, signal);
            return {
                items: items.filter((item) => this.catalog.isAllowed(item)),
                hasMore: false,
            };
        }
        const playlist = await firstValueFrom(
            this.playlists.getPlaylistById(playlistId)
        );
        signal.throwIfAborted();
        if (playlist?.macAddress) {
            const result = await this.stalker.browse(
                playlist,
                type,
                search,
                page,
                signal,
                seenPages,
                exhaustedCatalogs
            );
            return {
                ...result,
                items: result.items.filter((item) =>
                    this.catalog.isAllowed(item)
                ),
            };
        }
        if (!playlist?.serverUrl) return { items: [], hasMore: false };
        const credentials = await this.credentials(playlistId);
        signal.throwIfAborted();
        const categoryType = type === 'movie' ? 'vod' : 'series';
        const categories = await this.xtream.getCategories(
            playlistId,
            credentials,
            categoryType,
            { signal }
        );
        const byId = new Map(
            categories
                .filter(
                    (category) => !('hidden' in category && category.hidden)
                )
                .map((category) =>
                    'xtream_id' in category
                        ? ([String(category.id), category.xtream_id] as const)
                        : ([
                              String(category.category_id),
                              Number(category.category_id),
                          ] as const)
                )
        );
        const rows = await this.xtream.getContent(
            playlistId,
            credentials,
            type,
            undefined,
            undefined,
            { signal }
        );
        signal.throwIfAborted();
        const playlistName = sourceSortName(playlist);
        const items: UnifiedCollectionItem[] = [];
        for (const row of rows) {
            const categoryId = byId.get(String(row.category_id));
            const id = Number(
                'xtream_id' in row
                    ? row.xtream_id
                    : 'series_id' in row
                      ? row.series_id
                      : row.stream_id
            );
            if (!validId(id) || categoryId === undefined) continue;
            const item: UnifiedCollectionItem = {
                uid: buildXtreamCollectionUid(playlistId, type, id),
                sourceType: 'xtream',
                contentType: type,
                playlistId,
                playlistName,
                name: ('title' in row ? row.title : row.name) ?? '',
                posterUrl:
                    'poster_url' in row
                        ? row.poster_url
                        : 'cover' in row
                          ? row.cover
                          : row.stream_icon,
                xtreamId: id,
                categoryId,
            };
            if (this.catalog.isAllowed(item)) items.push(item);
        }
        return { items, hasMore: false };
    }

    async episodes(
        series: UnifiedCollectionItem,
        signal: AbortSignal
    ): Promise<SecondStreamEpisode[]> {
        if (series.sourceType === 'stalker') {
            return this.positionedStalkerEpisodes(series, signal);
        }
        const id = this.requireAllowed(series, 'series');
        const credentials = await this.credentials(series.playlistId);
        signal.throwIfAborted();
        const [details, positions] = await Promise.all([
            this.api.getSeriesInfo(credentials, id, { signal }),
            this.positions.getSeriesPlaybackPositions(series.playlistId, id),
        ]);
        signal.throwIfAborted();
        this.requireAllowed(series, 'series');
        const saved = new Map(
            positions.map((entry) => [entry.contentXtreamId, entry])
        );
        const rows: SecondStreamEpisode[] = [];
        for (const [season, episodes] of Object.entries(
            details?.episodes ?? {}
        )) {
            for (const episode of Array.isArray(episodes) ? episodes : []) {
                if (!validId(Number(episode?.id))) continue;
                rows.push({
                    episode,
                    season: Number(episode.season ?? season) || 0,
                    position: saved.get(Number(episode.id)) ?? null,
                });
            }
        }
        return rows.sort(
            (a, b) =>
                a.season - b.season ||
                a.episode.episode_num - b.episode.episode_num
        );
    }

    async resolveMovie(
        item: UnifiedCollectionItem
    ): Promise<SecondStreamSelection> {
        if (item.sourceType === 'stalker') return this.resolveStalker(item);
        const id = this.requireAllowed(item, 'movie');
        const saved = await this.positions.getPlaybackPosition(
            item.playlistId,
            id,
            'vod'
        );
        const resolved = await this.vod.resolve(
            {
                id: item.uid,
                playlistId: item.playlistId,
                playlistName: item.playlistName,
                portalType: 'xtream',
                contentId: id,
                rawTitle: item.name,
                matchConfidence: 'exact',
                posterUrl: item.posterUrl ?? null,
            },
            {
                startTime: resumeTime(saved),
                categoryId: item.categoryId,
                isCurrent: () => this.catalog.isAllowed(item),
            }
        );
        if (!resolved) throw new Error('Movie unavailable');
        this.requireAllowed(item, 'movie');
        return { item, playback: resolved.playback };
    }

    async resolveEpisode(
        series: UnifiedCollectionItem,
        row: SecondStreamEpisode
    ): Promise<SecondStreamSelection> {
        if (series.sourceType === 'stalker')
            return this.resolveStalker(series, row.episode);
        const seriesId = this.requireAllowed(series, 'series');
        const id = Number(row.episode.id);
        if (!validId(id)) throw new Error('Episode unavailable');
        const [credentials, saved] = await Promise.all([
            this.credentials(series.playlistId),
            this.positions.getPlaybackPosition(
                series.playlistId,
                id,
                'episode'
            ),
        ]);
        this.requireAllowed(series, 'series');
        const direct = row.episode.direct_source?.trim();
        const extension = row.episode.container_extension?.trim();
        const streamUrl =
            direct && /^https?:\/\//i.test(direct)
                ? direct
                : extension && /^[a-z0-9]+$/i.test(extension)
                  ? this.urls.constructEpisodeUrl(credentials, {
                        ...row.episode,
                        container_extension: extension,
                    })
                  : '';
        if (!streamUrl) throw new Error('Episode unavailable');
        const contentInfo: PlayerContentInfo = {
            playlistId: series.playlistId,
            contentType: 'episode',
            contentXtreamId: id,
            seriesXtreamId: seriesId,
            seasonNumber: row.season,
            episodeNumber: Number(row.episode.episode_num) || undefined,
        };
        return {
            item: series,
            playback: {
                streamUrl,
                title: row.episode.title || series.name,
                thumbnail: series.posterUrl,
                isLive: false,
                startTime: resumeTime(saved),
                contentInfo,
                userAgent: credentials.userAgent,
                referer: credentials.referrer,
                origin: credentials.origin,
            },
        };
    }

    private async positionedStalkerEpisodes(
        series: UnifiedCollectionItem,
        signal: AbortSignal
    ): Promise<SecondStreamEpisode[]> {
        const mapped = await this.stalker.episodes(
            await this.stalkerPlaylist(series),
            series,
            signal
        );
        const saved = await this.stalkerPositions(series, mapped);
        signal.throwIfAborted();
        if (!this.catalog.isAllowed(series))
            throw new Error('Source unavailable');
        const rows: SecondStreamEpisode[] = [];
        for (const [season, episodes] of Object.entries(mapped)) {
            for (const episode of episodes) {
                rows.push({
                    episode,
                    season: episode.season ?? Number(season),
                    position: saved.get(Number(episode.id)) ?? null,
                });
            }
        }
        return rows;
    }

    private async stalkerPositions(
        series: UnifiedCollectionItem,
        episodesBySeason: Record<string, XtreamSerieEpisode[]>
    ) {
        const seriesXtreamId = normalizeStalkerEntityIdAsNumber(
            series.stalkerId
        );
        if (seriesXtreamId == null)
            return new Map<number, PlaybackPositionData>();
        return reconcileStalkerSeriesPositions({
            seriesXtreamId,
            episodesBySeason,
            seriesPositions: await this.positions.getSeriesPlaybackPositions(
                series.playlistId,
                seriesXtreamId
            ),
        }).positionsByTrackingId;
    }

    private async stalkerPlaylist(item: UnifiedCollectionItem) {
        if (!this.catalog.isAllowed(item))
            throw new Error('Source unavailable');
        const playlist = await firstValueFrom(
            this.playlists.getPlaylistById(item.playlistId)
        );
        if (
            !playlist?.macAddress ||
            !(playlist.portalUrl ?? playlist.url) ||
            !this.catalog.isAllowed(item)
        )
            throw new Error('Source unavailable');
        return { ...playlist, portalUrl: playlist.portalUrl ?? playlist.url };
    }

    private async resolveStalker(
        item: UnifiedCollectionItem,
        episode?: XtreamSerieEpisode
    ): Promise<SecondStreamSelection> {
        const playback = await this.stalker.resolve(
            await this.stalkerPlaylist(item),
            item,
            episode
        );
        const info = playback.contentInfo;
        const saved = episode
            ? ((
                  await this.stalkerPositions(item, {
                      [episode.season ?? 0]: [episode],
                  })
              ).get(Number(episode.id)) ?? null)
            : info
              ? await this.positions.getPlaybackPosition(
                    info.playlistId,
                    info.contentXtreamId,
                    info.contentType
                )
              : null;
        if (!this.catalog.isAllowed(item))
            throw new Error('Source unavailable');
        return {
            item,
            playback: { ...playback, startTime: resumeTime(saved) },
        };
    }

    private requireAllowed(
        item: UnifiedCollectionItem,
        type: SecondStreamVodType
    ): number {
        const id = Number(item.xtreamId);
        if (
            item.sourceType !== 'xtream' ||
            item.contentType !== type ||
            !validId(id) ||
            !this.catalog.isAllowed(item)
        ) {
            throw new Error('Source unavailable');
        }
        return id;
    }

    private async credentials(playlistId: string) {
        const source = await this.xtream.getPlaylist(playlistId);
        if (!source) throw new Error('Source unavailable');
        return source;
    }
}

function validId(value: number): boolean {
    return Number.isSafeInteger(value) && value > 0;
}

function resumeTime(saved: PlaybackPositionData | null): number | undefined {
    const position = saved?.positionSeconds;
    if (!position || position < 0 || !Number.isFinite(position)) return;
    return isPortalPlaybackWatched(saved) ? undefined : position;
}
