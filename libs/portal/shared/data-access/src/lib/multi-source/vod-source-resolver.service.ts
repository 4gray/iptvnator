import { inject, Injectable, Injector } from '@angular/core';
import {
    XTREAM_DATA_SOURCE,
    XtreamApiService,
    XtreamUrlService,
    type IXtreamDataSource,
    type XtreamCredentials,
} from '@iptvnator/portal/xtream/data-access';
import type {
    ResolvedPortalPlayback,
    VodSourceCandidate,
} from '@iptvnator/shared/interfaces';
import { applyApiMetadata } from './vod-source-metadata.util';

/**
 * Turns a discovered source into something playable.
 *
 * This exists because discovery alone is not enough: the `content` table has
 * no `container_extension` column, and `constructVodUrl` returns '' without
 * one. Every alternative therefore costs one live `get_vod_info` against a
 * FOREIGN playlist's credentials — which is exactly why resolution is lazy and
 * never fanned out on page load.
 *
 * That same call is also the first moment real facts about a source exist, so
 * resolution doubles as the metadata upgrade from `parsed` to `api`.
 */

export interface ResolvedVodSource {
    playback: ResolvedPortalPlayback;
    /** The candidate with provider-stated facts merged in. */
    candidate: VodSourceCandidate;
}

@Injectable({ providedIn: 'root' })
export class VodSourceResolverService {
    /**
     * The Xtream chain is resolved LAZILY, never at construction.
     *
     * This service is root-provided but its dependencies are route-scoped
     * (`XTREAM_DATA_SOURCE` comes from `provideXtreamDataSource()`, and
     * `XtreamApiService` pulls in `DataService`). Injecting them eagerly would
     * make merely *providing* multi-source throw outside a fully configured
     * Xtream route. Resolution only ever happens on an explicit user action —
     * play, pin, or check — so deferring costs nothing and cannot explode.
     */
    private readonly injector = inject(Injector);

    private getXtreamDeps(): {
        dataSource: IXtreamDataSource;
        api: XtreamApiService;
        urlService: XtreamUrlService;
    } | null {
        const dataSource = this.injector.get(XTREAM_DATA_SOURCE, null, {
            optional: true,
        });
        if (!dataSource) {
            return null;
        }

        return {
            dataSource,
            api: this.injector.get(XtreamApiService),
            urlService: this.injector.get(XtreamUrlService),
        };
    }

    /**
     * Containers are immutable per (playlist, stream) and cost a network round
     * trip to learn, so the second visit to a movie resolves instantly.
     */
    private readonly containerCache = new Map<string, string>();

    async resolve(
        candidate: VodSourceCandidate,
        options: { startTime?: number } = {}
    ): Promise<ResolvedVodSource | null> {
        if (candidate.portalType !== 'xtream') {
            // v1 discovers Xtream only; the guard keeps a future Stalker
            // candidate from silently resolving to a broken Xtream URL.
            return null;
        }

        const deps = this.getXtreamDeps();
        if (!deps) {
            return null;
        }

        const playlist = await this.loadPlaylist(
            deps.dataSource,
            candidate.playlistId
        );
        if (!playlist) {
            return null;
        }

        const credentials: XtreamCredentials = {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
            allowedOutputFormats: playlist.allowedOutputFormats,
        };

        const details = await this.loadVodDetails(
            deps.api,
            credentials,
            candidate
        );
        if (!details) {
            return null;
        }

        const streamUrl = deps.urlService.constructVodUrl(
            credentials,
            details.vodDetails
        );
        if (!streamUrl) {
            return null;
        }

        return {
            playback: {
                streamUrl,
                title: candidate.rawTitle,
                thumbnail: candidate.posterUrl ?? null,
                isLive: false,
                startTime: options.startTime,
                contentInfo: {
                    // The NEW source owns the position from here on — the
                    // position key is (playlistId, contentXtreamId, type).
                    playlistId: candidate.playlistId,
                    contentXtreamId: candidate.contentId,
                    contentType: 'vod',
                },
                userAgent: playlist.userAgent,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
            candidate: applyApiMetadata(candidate, details.metadata),
        };
    }

    private async loadPlaylist(
        dataSource: IXtreamDataSource,
        playlistId: string
    ) {
        try {
            const playlist = await dataSource.getPlaylist(playlistId);
            // A foreign playlist can be missing credentials entirely (an M3U
            // row, or a partially imported portal) — resolving would build a
            // nonsense URL.
            if (!playlist?.serverUrl || !playlist.username) {
                return null;
            }
            return playlist;
        } catch (error) {
            console.warn('Loading the alternative playlist failed:', error);
            return null;
        }
    }

    private async loadVodDetails(
        api: XtreamApiService,
        credentials: XtreamCredentials,
        candidate: VodSourceCandidate
    ) {
        const cacheKey = `${candidate.playlistId}:${candidate.contentId}`;
        const cachedContainer = this.containerCache.get(cacheKey);

        try {
            const vodDetails = await api.getVodInfo(
                credentials,
                candidate.contentId
            );

            const info = Array.isArray(vodDetails?.info)
                ? undefined
                : vodDetails?.info;
            const video = info?.video as
                | { codec_name?: string; width?: number; height?: number }
                | undefined;
            const audio = info?.audio as { codec_name?: string } | undefined;

            const container = vodDetails?.movie_data?.container_extension;
            if (container) {
                this.containerCache.set(cacheKey, container);
            }

            return {
                vodDetails,
                metadata: {
                    containerExtension: container ?? null,
                    videoCodec: video?.codec_name ?? null,
                    audioCodec: audio?.codec_name ?? null,
                    width: video?.width ?? null,
                    height: video?.height ?? null,
                },
            };
        } catch (error) {
            console.warn('Reading alternative VOD details failed:', error);

            // The portal is unreachable right now, but a container learned on
            // a previous visit is still valid — enough to build a URL and let
            // playback itself report the real problem.
            if (!cachedContainer) {
                return null;
            }

            return {
                vodDetails: {
                    movie_data: {
                        stream_id: candidate.contentId,
                        container_extension: cachedContainer,
                    },
                } as Parameters<XtreamUrlService['constructVodUrl']>[1],
                metadata: { containerExtension: cachedContainer },
            };
        }
    }
}
