import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from 'm3u-state';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService } from 'services';
import {
    Playlist,
    PlaylistMeta,
    ResolvedPortalPlayback,
    STALKER_REQUEST,
    StalkerPortalActions,
    StalkerPortalItem,
} from 'shared-interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import { StalkerContentTypes } from '../../stalker-content-types';
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

type StalkerContentType = 'itv' | 'vod' | 'series';

interface StalkerPlayableItem extends StalkerPortalItem {
    cmd?: string;
    has_files?: unknown;
}

interface StalkerPlayerStoreLike {
    selectedContentType: () => StalkerContentType;
    currentPlaylist: () => Playlist | null;
    selectedItem: () => StalkerPlayableItem | null;
    addToRecentlyViewed?: (item: Record<string, unknown>) => void;
}

interface StalkerResponse {
    js?: {
        error?: string;
        cmd?: string;
        data?: Array<{ id?: string | number }>;
        account_info?: {
            expire_date?: string | number;
        };
    };
}

/**
 * Playback/link/player concern methods.
 */
export function withStalkerPlayer() {
    const logger = createLogger('withStalkerPlayer');
    const resolveCategoryId = (value: unknown, fallback: string): string => {
        const normalized = String(value ?? '').trim();
        return normalized || fallback;
    };
    const getSeriesRecentMetadata = (
        selectedContentType: StalkerContentType
    ): {
        category_id?: 'series';
        is_series?: true;
    } => {
        if (selectedContentType !== 'series') {
            return {};
        }

        return {
            category_id: 'series',
            is_series: true,
        };
    };
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
                const storeState = store as unknown as StalkerPlayerStoreLike;
                const fetchLinkToPlayInternal = async (
                    portalUrl: string,
                    macAddress: string,
                    cmd: string,
                    series?: number,
                    forcedContentType?: StalkerContentType
                ) => {
                    const normalizeCmdValue = (value: string): string => {
                        const trimmed = String(value ?? '').trim();
                        if (!trimmed) return '';

                        // Some portals prepend transport wrappers like:
                        // "ffmpeg http://...", "ffrt http://...", etc.
                        const splitAt = trimmed.indexOf(' ');
                        if (splitAt > 0) {
                            const candidate = trimmed.slice(splitAt + 1).trim();
                            if (
                                candidate.startsWith('http://') ||
                                candidate.startsWith('https://') ||
                                candidate.startsWith('/') ||
                                candidate.startsWith('?')
                            ) {
                                return candidate;
                            }
                        }

                        return trimmed;
                    };

                    const selectedContentType =
                        forcedContentType ?? storeState.selectedContentType();
                    const type = series ? 'vod' : selectedContentType;

                    // Always use create_link to get the tokenized streaming URL
                    // The server adds the required token for playback authorization
                    // Note: cmd is already transformed during item processing (has_files items)
                    const params = {
                        action: StalkerContentTypes[selectedContentType]
                            .getLink,
                        cmd: cmd,
                        type,
                        disable_ad: '0',
                        download: '0',
                        JsHttpRequest: '1-xml',
                        ...(series ? { series: String(series) } : {}),
                    };

                    // Use makeAuthenticatedRequest for automatic retry on auth failure
                    const playlist = storeState.currentPlaylist();
                    let response: StalkerResponse;
                    if (playlist?.isFullStalkerPortal) {
                        // Full stalker portal - use authenticated request with retry
                        response =
                            await stalkerSession.makeAuthenticatedRequest(
                                playlist,
                                params
                            );
                    } else {
                        // Simple stalker portal - no auth needed
                        response = await dataService.sendIpcEvent(
                            STALKER_REQUEST,
                            {
                                url: portalUrl,
                                macAddress,
                                params,
                            }
                        );
                    }

                    // Check for server-side errors
                    if (response.js?.error) {
                        const errorMsg = response.js.error;
                        logger.error('Server error', errorMsg);
                        throw new Error(errorMsg);
                    }

                    let url = normalizeCmdValue(response.js.cmd as string);

                    // If cmd is empty, the content is not available
                    if (!url) {
                        throw new Error('nothing_to_play');
                    }

                    // Handle incomplete URLs - some portals return just query params or relative paths
                    if (
                        url &&
                        !url.startsWith('http://') &&
                        !url.startsWith('https://')
                    ) {
                        // Extract base URL from portal URL
                        try {
                            const portalUrlObj = new URL(portalUrl);
                            // Get the stalker portal base path (e.g., /stalker_portal from /stalker_portal/server/load.php)
                            const pathParts = portalUrlObj.pathname.split('/');
                            // Find the stalker_portal or c directory and use that as base
                            let basePath = '';
                            for (let i = 0; i < pathParts.length; i++) {
                                if (
                                    pathParts[i] === 'stalker_portal' ||
                                    pathParts[i] === 'c' ||
                                    pathParts[i] === 'portal'
                                ) {
                                    basePath =
                                        '/' +
                                        pathParts.slice(1, i + 1).join('/');
                                    break;
                                }
                            }

                            // If url starts with ?, it's just query params
                            // Combine with the original cmd path to form the complete streaming URL
                            if (url.startsWith('?')) {
                                const normalizedCmd = normalizeCmdValue(cmd);
                                // The streaming URL is: portal origin + base path + original cmd path + token query
                                // e.g., http://portal.com + /stalker_portal + /media/12345.mpg + ?token=xxx
                                if (
                                    normalizedCmd.startsWith('http://') ||
                                    normalizedCmd.startsWith('https://')
                                ) {
                                    url = `${normalizedCmd}${url}`;
                                } else {
                                    url = `${portalUrlObj.origin}${basePath}${normalizedCmd}${url}`;
                                }
                            } else if (url.startsWith('/')) {
                                // Relative path - prepend origin and base path
                                url = `${portalUrlObj.origin}${basePath}${url}`;
                            }
                        } catch {
                            // URL parsing failed, return as-is
                        }
                    }
                    return url;
                };

                const fetchMovieFileIdInternal = async (
                    movieId: string
                ): Promise<string | null> => {
                    const playlist = storeState.currentPlaylist();
                    if (!playlist) return null;

                    const queryParams = {
                        action: StalkerPortalActions.GetOrderedList,
                        type: 'vod',
                        movie_id: movieId,
                        p: '1',
                    };

                    let response: StalkerResponse;
                    if (playlist.isFullStalkerPortal) {
                        response =
                            await stalkerSession.makeAuthenticatedRequest(
                                playlist,
                                queryParams
                            );
                    } else {
                        response = await dataService.sendIpcEvent(
                            STALKER_REQUEST,
                            {
                                url: playlist.portalUrl,
                                macAddress: playlist.macAddress,
                                params: queryParams,
                            }
                        );
                    }

                    // Extract id from the first data item
                    if (response?.js?.data?.[0]?.id) {
                        const fileId = response.js.data[0].id;
                        return String(fileId);
                    }

                    return null;
                };

                const resolveVodPlaybackInternal = async (
                    cmd?: string,
                    title?: string,
                    thumbnail?: string,
                    episodeNum?: number,
                    episodeId?: number,
                    startTime?: number
                ): Promise<ResolvedPortalPlayback> => {
                    const item = storeState.selectedItem();
                    let cmdToUse = cmd ?? item?.cmd;

                    if (!cmdToUse) {
                        throw new Error('nothing_to_play');
                    }

                    // For items with has_files and relative path, we need to fetch the file id first
                    if (
                        item?.has_files !== undefined &&
                        cmdToUse &&
                        !cmdToUse.includes('://') &&
                        cmdToUse.includes('/media/') &&
                        !cmdToUse.includes('/media/file_')
                    ) {
                        const fileId = await fetchMovieFileIdInternal(
                            normalizeStalkerEntityId(item.id)
                        );
                        if (fileId) {
                            cmdToUse = `/media/file_${fileId}.mpg`;
                        }
                    }

                    const playlist = storeState.currentPlaylist();
                    if (!playlist) {
                        throw new Error('nothing_to_play');
                    }

                    const streamUrl = await fetchLinkToPlayInternal(
                        playlist.portalUrl,
                        playlist.macAddress,
                        cmdToUse,
                        episodeNum
                    );

                    if (typeof storeState.addToRecentlyViewed === 'function') {
                        storeState.addToRecentlyViewed({
                            ...item,
                            id: item?.id,
                            cmd: cmd,
                            cover: thumbnail,
                            title,
                        });
                    } else {
                        addToRecentlyViewedInternal(
                            item,
                            cmd,
                            thumbnail,
                            title
                        );
                    }

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
                            // For episodes, use episodeId if provided, otherwise fall back to item.id
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
                    if (!playlist || !item?.cmd) {
                        throw new Error('nothing_to_play');
                    }

                    const streamUrl = await fetchLinkToPlayInternal(
                        playlist.portalUrl,
                        playlist.macAddress,
                        item.cmd,
                        undefined,
                        'itv'
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

                    if (typeof storeState.addToRecentlyViewed === 'function') {
                        storeState.addToRecentlyViewed({
                            ...item,
                            id: item.id,
                            cover: item.logo ?? item.cover,
                            title: item.o_name || item.name || item.title,
                        });
                    }

                    return {
                        streamUrl,
                        title: item.o_name || item.name || item.title || '',
                        thumbnail: item.logo ?? item.cover ?? null,
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

                const addToRecentlyViewedInternal = (
                    item: StalkerPlayableItem,
                    cmd?: string,
                    cover?: string,
                    title?: string
                ) => {
                    const playlistId = storeState.currentPlaylist()?._id;
                    if (!playlistId) return;
                    const selectedContentType =
                        storeState.selectedContentType();
                    const recentlyViewedItem: {
                        id: string;
                        title: string;
                    } & Record<string, unknown> = {
                        ...item,
                        id: normalizeStalkerEntityId(item?.id),
                        cmd,
                        cover,
                        title,
                        category_id: resolveCategoryId(
                            item.category_id,
                            selectedContentType
                        ),
                        ...getSeriesRecentMetadata(selectedContentType),
                        added_at: Date.now(),
                    };
                    playlistService
                        .addPortalRecentlyViewed(playlistId, recentlyViewedItem)
                        .subscribe((updatedPlaylist) => {
                            ngrxStore.dispatch(
                                PlaylistActions.updatePlaylistMeta({
                                    playlist: {
                                        _id: playlistId,
                                        recentlyViewed:
                                            updatedPlaylist?.recentlyViewed,
                                    } as PlaylistMeta,
                                })
                            );
                        });
                };

                return {
                    async fetchLinkToPlay(
                        portalUrl: string,
                        macAddress: string,
                        cmd: string,
                        series?: number
                    ) {
                        return fetchLinkToPlayInternal(
                            portalUrl,
                            macAddress,
                            cmd,
                            series
                        );
                    },
                    async getExpireDate() {
                        const params = {
                            type: 'account_info',
                            action: 'get_main_info',
                            JsHttpRequest: '1-xml',
                        };

                        try {
                            // Use makeAuthenticatedRequest for automatic retry on auth failure
                            const playlist = storeState.currentPlaylist();
                            let response: StalkerResponse;
                            if (!playlist) {
                                return 'Unknown';
                            }
                            if (playlist?.isFullStalkerPortal) {
                                // Full stalker portal - use authenticated request with retry
                                response =
                                    await stalkerSession.makeAuthenticatedRequest(
                                        playlist,
                                        params
                                    );
                            } else {
                                // Simple stalker portal - no auth needed
                                response = await dataService.sendIpcEvent(
                                    STALKER_REQUEST,
                                    {
                                        url: playlist.portalUrl,
                                        macAddress: playlist.macAddress,
                                        params,
                                    }
                                );
                            }

                            if (
                                response &&
                                response.js &&
                                response.js.account_info
                            ) {
                                // Extract the expire date from the response
                                const expireDate =
                                    response.js.account_info.expire_date;
                                const numericExpireDate = Number(expireDate);

                                // Convert timestamp to readable date if it's a unix timestamp
                                if (
                                    expireDate &&
                                    !Number.isNaN(numericExpireDate)
                                ) {
                                    const date = new Date(
                                        numericExpireDate * 1000
                                    ); // Convert seconds to milliseconds
                                    return date.toLocaleDateString();
                                }

                                return expireDate || 'Unknown';
                            }

                            return 'Unknown';
                        } catch (error) {
                            logger.error('Failed to fetch expire date', error);
                            return 'Error fetching data';
                        }
                    },
                    /**
                     * Fetch movie files using get_ordered_list with movie_id parameter.
                     * This is needed for items with has_files property to get the correct video_id
                     * for the create_link request.
                     */
                    async fetchMovieFileId(
                        movieId: string
                    ): Promise<string | null> {
                        return fetchMovieFileIdInternal(movieId);
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
                    /**
                     * Play VOD or episode content
                     * @param cmd The media command/path
                     * @param title Display title
                     * @param thumbnail Thumbnail URL
                     * @param episodeNum Episode number (for series param in API)
                     * @param episodeId Optional episode ID for playback tracking (defaults to item.id)
                     * @param startTime Optional start time in seconds for resume playback
                     */
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
                                error?.message === 'nothing_to_play'
                                    ? translate.instant(
                                          'PORTALS.CONTENT_NOT_AVAILABLE'
                                      )
                                    : translate.instant(
                                          'PORTALS.PLAYBACK_ERROR'
                                      );
                            snackBar.open(errorMessage, null, {
                                duration: 3000,
                            });
                        }
                    },
                };
            }
        )
    );
}
