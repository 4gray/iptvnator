import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYER, createLogger } from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService } from '@iptvnator/services';
import {
    PlaylistMeta,
    ResolvedPortalPlayback,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import {
    buildStalkerExternalPlaybackHeaders,
    getStalkerPortalOrigin,
    isCrossOriginStalkerStream,
    STALKER_MAG_USER_AGENT,
} from '../../stalker-live-playback.utils';
import { StalkerSessionService } from '../../stalker-session.service';
import {
    normalizeStalkerEntityId,
    normalizeStalkerEntityIdAsNumber,
} from '../../stalker-vod.utils';
import {
    StalkerPlayerFeatureStoreContract,
    StalkerRecentlyViewedItem,
} from '../stalker-store.contracts';
import {
    buildStalkerRecentlyViewedPayload,
    dispatchStalkerPlaylistMetaUpdate,
    fetchStalkerExpireDate,
    fetchStalkerMovieFileId,
    fetchStalkerPlaybackLink,
    normalizeStalkerPlaybackCommand,
    shouldResolveMovieFileId,
} from '../utils';

type StalkerPlayableItem = StalkerPortalItem & {
    cmd?: string;
    has_files?: unknown;
};

/**
 * Playback/link/player concern methods.
 */
export function withStalkerPlayer() {
    const logger = createLogger('withStalkerPlayer');

    return signalStoreFeature(
        withMethods(
            (
                store,
                dataService = inject(DataService),
                playlistService = inject(PlaylistsService),
                playerService = inject(PORTAL_PLAYER),
                stalkerSession = inject(StalkerSessionService),
                snackBar = inject(MatSnackBar),
                translate = inject(TranslateService),
                ngrxStore = inject(Store)
            ) => {
                const storeState = store as typeof store &
                    StalkerPlayerFeatureStoreContract;
                const requestDeps = {
                    dataService,
                    stalkerSession,
                };

                const createRequestPlaylist = (
                    portalUrl: string,
                    macAddress: string
                ): PlaylistMeta => {
                    const playlist = storeState.currentPlaylist();

                    return {
                        ...playlist,
                        _id: playlist?._id ?? 'stalker-player',
                        title: playlist?.title ?? 'Stalker Portal',
                        count: playlist?.count ?? 0,
                        autoRefresh: playlist?.autoRefresh ?? false,
                        importDate: playlist?.importDate ?? '',
                        portalUrl,
                        macAddress,
                    };
                };

                const persistRecentlyViewed = (
                    playlistId: string,
                    recentItem: StalkerRecentlyViewedItem
                ): void => {
                    playlistService
                        .addPortalRecentlyViewed(playlistId, recentItem)
                        .subscribe((updatedPlaylist) => {
                            dispatchStalkerPlaylistMetaUpdate(
                                ngrxStore,
                                playlistId,
                                {
                                    recentlyViewed:
                                        updatedPlaylist?.recentlyViewed,
                                }
                            );
                        });
                };

                const buildRecentlyViewedItem = (
                    item: StalkerPlayableItem,
                    cmd?: string,
                    cover?: string,
                    title?: string
                ): StalkerRecentlyViewedItem =>
                    buildStalkerRecentlyViewedPayload(
                        {
                            ...item,
                            cmd,
                            cover,
                            title,
                        },
                        storeState.selectedContentType()
                    );

                const recordRecentlyViewed = (
                    item: StalkerPlayableItem | null | undefined,
                    cmd?: string,
                    cover?: string,
                    title?: string
                ): void => {
                    const playlistId = storeState.currentPlaylist()?._id;
                    if (!item || !playlistId) {
                        return;
                    }

                    const recentItem = buildRecentlyViewedItem(
                        item,
                        cmd,
                        cover,
                        title
                    );

                    if (typeof storeState.addToRecentlyViewed === 'function') {
                        storeState.addToRecentlyViewed(recentItem);
                        return;
                    }

                    persistRecentlyViewed(playlistId, recentItem);
                };

                const resolveVodPlaybackInternal = async (
                    cmd?: string,
                    title?: string,
                    thumbnail?: string,
                    episodeNum?: number,
                    episodeId?: number,
                    startTime?: number
                ): Promise<ResolvedPortalPlayback> => {
                    const item = storeState.selectedItem() as
                        | StalkerPlayableItem
                        | null
                        | undefined;
                    let cmdToUse = cmd ?? item?.cmd;

                    if (!cmdToUse) {
                        throw new Error('nothing_to_play');
                    }

                    const playlist = storeState.currentPlaylist();
                    if (!playlist?.portalUrl || !playlist.macAddress) {
                        throw new Error('nothing_to_play');
                    }

                    if (shouldResolveMovieFileId(item, cmdToUse)) {
                        const itemId = normalizeStalkerEntityId(item?.id);
                        const fileId = await fetchStalkerMovieFileId(
                            requestDeps,
                            playlist,
                            itemId
                        );
                        if (fileId) {
                            cmdToUse = `/media/file_${fileId}.mpg`;
                        }
                    }

                    const streamUrl = await fetchStalkerPlaybackLink(
                        requestDeps,
                        {
                            playlist,
                            selectedContentType:
                                storeState.selectedContentType(),
                            cmd: cmdToUse,
                            series: episodeNum,
                        }
                    );

                    recordRecentlyViewed(item, cmd, thumbnail, title);

                    const isEpisode =
                        episodeNum !== undefined || episodeId !== undefined;
                    const selectedItemId =
                        normalizeStalkerEntityIdAsNumber(item?.id) ?? 0;

                    return {
                        streamUrl,
                        title: title ?? '',
                        thumbnail,
                        startTime,
                        userAgent: playlist.userAgent,
                        referer: playlist.referrer,
                        origin: playlist.origin,
                        contentInfo: {
                            playlistId: playlist._id,
                            contentXtreamId:
                                isEpisode && episodeId
                                    ? episodeId
                                    : selectedItemId,
                            contentType: isEpisode ? 'episode' : 'vod',
                            seriesXtreamId: isEpisode
                                ? selectedItemId
                                : undefined,
                        },
                    };
                };

                const resolveItvPlaybackInternal = async (
                    item: StalkerPlayableItem
                ): Promise<ResolvedPortalPlayback> => {
                    const playlist = storeState.currentPlaylist();
                    if (
                        !playlist?.portalUrl ||
                        !playlist.macAddress ||
                        !item.cmd
                    ) {
                        throw new Error('nothing_to_play');
                    }

                    const streamUrl = await fetchStalkerPlaybackLink(
                        requestDeps,
                        {
                            playlist,
                            selectedContentType:
                                storeState.selectedContentType(),
                            cmd: item.cmd,
                            forcedContentType: 'itv',
                        }
                    );

                    const token = stalkerSession.getCachedToken(playlist._id);
                    const headers = buildStalkerExternalPlaybackHeaders(
                        playlist,
                        token,
                        streamUrl
                    );
                    const crossOriginStream = isCrossOriginStalkerStream(
                        playlist,
                        streamUrl
                    );
                    const portalOrigin = getStalkerPortalOrigin(playlist);

                    recordRecentlyViewed(
                        item,
                        item.cmd,
                        item.logo ?? item.cover,
                        item.o_name || item.name || item.title
                    );

                    return {
                        streamUrl,
                        title: item.o_name || item.name || item.title || '',
                        thumbnail: item.logo ?? item.cover ?? null,
                        isLive: true,
                        headers,
                        userAgent:
                            headers['User-Agent'] ||
                            playlist.userAgent ||
                            STALKER_MAG_USER_AGENT,
                        referer: crossOriginStream
                            ? undefined
                            : playlist.referrer || portalOrigin,
                        origin: crossOriginStream
                            ? undefined
                            : playlist.origin || portalOrigin,
                    };
                };

                const resolveRadioPlaybackInternal = async (
                    item: StalkerPlayableItem
                ): Promise<ResolvedPortalPlayback> => {
                    const playlist = storeState.currentPlaylist();
                    if (
                        !playlist?.portalUrl ||
                        !playlist.macAddress ||
                        !item.cmd
                    ) {
                        throw new Error('nothing_to_play');
                    }

                    let streamUrl = normalizeStalkerPlaybackCommand(item.cmd);
                    if (
                        !streamUrl.startsWith('http://') &&
                        !streamUrl.startsWith('https://')
                    ) {
                        streamUrl = await fetchStalkerPlaybackLink(
                            requestDeps,
                            {
                                playlist,
                                selectedContentType:
                                    storeState.selectedContentType(),
                                cmd: item.cmd,
                                forcedContentType: 'radio',
                            }
                        );
                    }

                    if (!streamUrl) {
                        throw new Error('nothing_to_play');
                    }

                    recordRecentlyViewed(
                        item,
                        item.cmd,
                        item.logo ?? item.cover,
                        item.o_name || item.name || item.title
                    );

                    return {
                        streamUrl,
                        title: item.o_name || item.name || item.title || '',
                        thumbnail: item.logo ?? item.cover ?? null,
                        userAgent: playlist.userAgent,
                        referer: playlist.referrer,
                        origin: playlist.origin,
                    };
                };

                return {
                    async fetchLinkToPlay(
                        portalUrl: string,
                        macAddress: string,
                        cmd: string,
                        series?: number
                    ) {
                        return fetchStalkerPlaybackLink(requestDeps, {
                            playlist: createRequestPlaylist(
                                portalUrl,
                                macAddress
                            ),
                            selectedContentType:
                                storeState.selectedContentType(),
                            cmd,
                            series,
                        });
                    },
                    async getExpireDate() {
                        const playlist = storeState.currentPlaylist();
                        if (!playlist) {
                            return 'Unknown';
                        }

                        try {
                            return await fetchStalkerExpireDate(
                                requestDeps,
                                playlist
                            );
                        } catch (error) {
                            logger.error('Failed to fetch expire date', error);
                            return 'Error fetching data';
                        }
                    },
                    async fetchMovieFileId(
                        movieId: string
                    ): Promise<string | null> {
                        const playlist = storeState.currentPlaylist();
                        if (!playlist) {
                            return null;
                        }

                        return fetchStalkerMovieFileId(
                            requestDeps,
                            playlist,
                            movieId
                        );
                    },
                    async resolveVodPlayback(
                        cmd?: string,
                        title?: string,
                        thumbnail?: string,
                        episodeNum?: number,
                        episodeId?: number,
                        startTime?: number
                    ): Promise<ResolvedPortalPlayback> {
                        return resolveVodPlaybackInternal(
                            cmd,
                            title,
                            thumbnail,
                            episodeNum,
                            episodeId,
                            startTime
                        );
                    },
                    async resolveItvPlayback(
                        item: StalkerPlayableItem
                    ): Promise<ResolvedPortalPlayback> {
                        return resolveItvPlaybackInternal(item);
                    },
                    async resolveRadioPlayback(
                        item: StalkerPlayableItem
                    ): Promise<ResolvedPortalPlayback> {
                        return resolveRadioPlaybackInternal(item);
                    },
                    async createLinkToPlayVod(
                        cmd?: string,
                        title?: string,
                        thumbnail?: string,
                        episodeNum?: number,
                        episodeId?: number,
                        startTime?: number
                    ) {
                        try {
                            const playback = await resolveVodPlaybackInternal(
                                cmd,
                                title,
                                thumbnail,
                                episodeNum,
                                episodeId,
                                startTime
                            );

                            void playerService.openResolvedPlayback(
                                playback,
                                true
                            );
                        } catch (error) {
                            logger.error('Failed to get playback URL', error);
                            const errorMessage =
                                error instanceof Error &&
                                error.message === 'nothing_to_play'
                                    ? translate.instant(
                                          'PORTALS.CONTENT_NOT_AVAILABLE'
                                      )
                                    : translate.instant(
                                          'PORTALS.PLAYBACK_ERROR'
                                      );

                            snackBar.open(errorMessage, undefined, {
                                duration: 3000,
                            });
                        }
                    },
                };
            }
        )
    );
}
