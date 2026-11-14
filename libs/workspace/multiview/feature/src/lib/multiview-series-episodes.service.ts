import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { MultiviewTileSource } from '@iptvnator/playback/multiview/data-access';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import {
    createInlinePlaybackPositionWriter,
    getUnifiedCollectionDetailNavigation,
    PORTAL_PLAYBACK_POSITIONS,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    XtreamApiService,
    type XtreamCredentials,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { PlaylistsService } from '@iptvnator/services';
import type {
    PlaybackPositionData,
    ResolvedPortalPlayback,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { MultiviewUnresolvableError } from './multiview-tile-resolver';
import { MultiviewXtreamLock } from './multiview-xtream-lock';

/** One episode in the picker's "Episodes" view. */
export interface MultiviewEpisodeRow {
    readonly sessionKey: string;
    readonly season: number;
    readonly number: number;
    readonly title: string;
    readonly position: PlaybackPositionData | null;
    readonly inTile: number | null;
    readonly episode: XtreamSerieEpisode;
}

interface XtreamSeriesSource {
    readonly credentials: XtreamCredentials;
    readonly playlist: {
        userAgent?: string;
        referrer?: string;
        origin?: string;
    };
}

function episodeKey(
    series: UnifiedCollectionItem,
    episode: XtreamSerieEpisode
): string {
    return createPlaybackSessionKey({
        kind: 'episode',
        sourceId: series.playlistId,
        contentId: episode.id,
        seriesId: series.xtreamId,
        seasonNumber: Number(episode.season),
        episodeNumber: Number(episode.episode_num),
    });
}

/**
 * Episodes of an Xtream series for the picker (spec 9.5 "Episodes ›", the
 * only drill-down) and their resolution into a tile that resumes and saves
 * progress like the series page does. Other providers' series list none.
 */
@Injectable({ providedIn: 'root' })
export class MultiviewSeriesEpisodesService {
    private readonly playlists = inject(PlaylistsService);
    private readonly api = inject(XtreamApiService);
    private readonly urls = inject(XtreamUrlService);
    private readonly positions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly router = inject(Router);
    private readonly xtreamLock = inject(MultiviewXtreamLock);

    hasEpisodes(item: UnifiedCollectionItem): boolean {
        return (
            item.contentType === 'series' &&
            item.sourceType === 'xtream' &&
            item.xtreamId != null
        );
    }

    async load(
        series: UnifiedCollectionItem,
        tiles: readonly MultiviewTileSource[]
    ): Promise<MultiviewEpisodeRow[]> {
        if (!this.hasEpisodes(series)) return [];
        const source = await this.source(series.playlistId);
        const seriesId = series.xtreamId as number;
        const [details, saved] = await Promise.all([
            this.api.getSeriesInfo(source.credentials, seriesId),
            this.positions.getSeriesPlaybackPositions(
                series.playlistId,
                seriesId
            ),
        ]);
        const byEpisode = new Map(
            saved.map((position) => [position.contentXtreamId, position])
        );
        const episodes: XtreamSerieEpisode[] = [];
        for (const season of Object.values(details?.episodes ?? {})) {
            episodes.push(...season);
        }
        return episodes
            .map((episode) => {
                const sessionKey = episodeKey(series, episode);
                const index = tiles.findIndex(
                    (tile) => tile.playbackSessionKey === sessionKey
                );
                return {
                    sessionKey,
                    season: Number(episode.season),
                    number: Number(episode.episode_num),
                    title: episode.title,
                    position: byEpisode.get(Number(episode.id)) ?? null,
                    inTile: index === -1 ? null : index + 1,
                    episode,
                };
            })
            .sort((a, b) => a.season - b.season || a.number - b.number);
    }

    async resolve(
        series: UnifiedCollectionItem,
        row: MultiviewEpisodeRow
    ): Promise<MultiviewTileSource> {
        if (await this.xtreamLock.isLocked(series)) {
            throw new MultiviewUnresolvableError();
        }
        const { credentials, playlist } = await this.source(series.playlistId);
        const streamUrl =
            row.episode.direct_source?.trim() ||
            this.urls.constructEpisodeUrl(credentials, row.episode);
        if (!streamUrl) throw new MultiviewUnresolvableError();
        const position = row.position?.positionSeconds || undefined;
        const playback: ResolvedPortalPlayback = {
            streamUrl,
            title: `${series.name} · S${row.season} E${row.number}`,
            thumbnail: series.posterUrl ?? null,
            isLive: false,
            startTime: position,
            contentInfo: {
                playlistId: series.playlistId,
                contentXtreamId: Number(row.episode.id),
                contentType: 'episode',
                seriesXtreamId: series.xtreamId,
                seasonNumber: row.season,
                episodeNumber: row.number,
            },
            userAgent: playlist.userAgent,
            referer: playlist.referrer,
            origin: playlist.origin,
        };
        const writer = createInlinePlaybackPositionWriter({
            playback: signal<ResolvedPortalPlayback | null>(playback),
            save: (playlistId, data) =>
                void this.positions.savePlaybackPosition(playlistId, data),
        });
        const target = getUnifiedCollectionDetailNavigation(series);
        return {
            playback,
            playbackSessionKey: row.sessionKey,
            kind: 'episode',
            playlistId: series.playlistId,
            contentId: row.episode.id,
            title: playback.title,
            position,
            persistPosition: (event) => void writer.handleTimeUpdate(event),
            reopen: target
                ? () =>
                      void this.router.navigate(target.link, {
                          state: target.state,
                      })
                : undefined,
        };
    }

    private async source(playlistId: string): Promise<XtreamSeriesSource> {
        const playlist = await firstValueFrom(
            this.playlists.getPlaylistById(playlistId)
        );
        if (!playlist?.serverUrl || !playlist.username || !playlist.password) {
            throw new MultiviewUnresolvableError();
        }
        return {
            credentials: {
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
                userAgent: playlist.userAgent?.trim() || undefined,
            },
            playlist,
        };
    }
}
