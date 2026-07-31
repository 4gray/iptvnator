import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { createMovieDownloadSnapshot } from '@iptvnator/portal/shared/util';
import { DownloadsService } from '@iptvnator/services';
import { resolveXtreamVodPlaybackSource } from '@iptvnator/portal/xtream/data-access';
import {
    getXtreamVodInfo,
    XtreamVodDetails,
    type XtreamVodInfo,
} from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { resolveXtreamVodPlaybackPresentation } from './vod-details-playback-presentation';

function textList(value: string | undefined): string[] | undefined {
    const entries = value
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    return entries?.length ? entries : undefined;
}

function number(value: number | string | undefined): number | undefined {
    if (value === undefined || String(value).trim() === '') {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function year(value: string | undefined): number | undefined {
    const match = value?.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
    return match ? Number(match[1]) : undefined;
}

function durationMinutes(info: XtreamVodInfo | null): number | undefined {
    const seconds = number(info?.duration_secs);
    if (seconds && seconds > 0) {
        return Math.round(seconds / 60);
    }
    const minutes = number(info?.episode_run_time);
    return minutes && minutes > 0 ? Math.round(minutes) : undefined;
}

/**
 * Offline downloads for the movie on screen.
 *
 * Every read re-touches `downloads()` so the computed tracks the signal the
 * service updates — the per-item helpers are plain lookups and would not
 * otherwise re-run when a download's state changes.
 */
@Injectable()
export class VodDetailsDownloadsService {
    private readonly downloadsService = inject(DownloadsService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly translateService = inject(TranslateService);

    private routeContentId: Signal<number> = signal(NaN);

    bind(bindings: { routeContentId: Signal<number> }): void {
        this.routeContentId = bindings.routeContentId;
    }

    private readonly context = computed(() => {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        // Read so the state below re-derives as downloads progress.
        this.downloadsService.downloads();
        return playlistId ? { playlistId, vodId: this.routeContentId() } : null;
    });

    readonly isDownloaded = computed(() => {
        const context = this.context();
        return context
            ? this.downloadsService.isDownloaded(
                  context.vodId,
                  context.playlistId,
                  'vod'
              )
            : false;
    });

    readonly isDownloading = computed(() => {
        const context = this.context();
        return context
            ? this.downloadsService.isDownloading(
                  context.vodId,
                  context.playlistId,
                  'vod'
              )
            : false;
    });

    readonly isPausedDownload = computed(() => {
        const context = this.context();
        return context
            ? this.downloadsService.isPaused(
                  context.vodId,
                  context.playlistId,
                  'vod'
              )
            : false;
    });

    async resumePaused(): Promise<void> {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) {
            return;
        }

        await this.downloadsService.resumeDownloadByContent(
            this.routeContentId(),
            playlistId,
            'vod'
        );
    }

    async start(vodItem: XtreamVodDetails | null): Promise<void> {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!vodItem || !playlist) {
            return;
        }

        // A provider can omit the route id entirely (sparse details), and the
        // resolved source is then the only place the stream id exists.
        const source = resolveXtreamVodPlaybackSource(vodItem);
        if (!source) {
            return;
        }

        const presentation = resolveXtreamVodPlaybackPresentation(vodItem);
        const info = getXtreamVodInfo(vodItem);
        const routeVodId = this.routeContentId();
        const id =
            Number.isSafeInteger(routeVodId) && routeVodId > 0
                ? routeVodId
                : source.streamId;

        await this.downloadsService.startDownload({
            playlistId: playlist.id,
            xtreamId: id,
            contentType: 'vod',
            title: presentation.title,
            url: this.xtreamStore.constructVodStreamUrl(vodItem),
            posterUrl: presentation.posterUrl,
            metadataSnapshot: createMovieDownloadSnapshot({
                language:
                    this.translateService.currentLang ||
                    this.translateService.defaultLang ||
                    'en',
                title: presentation.title,
                originalTitle: info?.o_name,
                plot: info?.description || info?.plot,
                releaseDate: info?.releasedate,
                year: year(info?.releasedate),
                durationMinutes: durationMinutes(info),
                genres: textList(info?.genre),
                rating: number(info?.rating_imdb),
                status: info?.status,
                posterUrl: presentation.posterUrl,
                backdropUrl: info?.backdrop_path?.[0],
                tmdbId: number(info?.tmdb_id),
                providerCategoryId: vodItem.movie_data?.category_id,
                cast: info?.tmdb_cast?.length
                    ? info.tmdb_cast.map((person) => ({
                          name: person.name,
                          role: person.character,
                          profileUrl: person.profileUrl ?? undefined,
                          tmdbPersonId: person.tmdbPersonId,
                      }))
                    : textList(info?.actors || info?.cast)?.map((name) => ({
                          name,
                      })),
                creators: info?.tmdb_directors?.length
                    ? info.tmdb_directors.map((person) => ({
                          name: person.name,
                          role: person.character,
                          profileUrl: person.profileUrl ?? undefined,
                          tmdbPersonId: person.tmdbPersonId,
                      }))
                    : textList(info?.director)?.map((name) => ({ name })),
            }),
            headers: {
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
        });
    }

    async playLocal(): Promise<void> {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId) {
            return;
        }

        const filePath = this.downloadsService.getDownloadedFilePath(
            this.routeContentId(),
            playlistId,
            'vod'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }
}
