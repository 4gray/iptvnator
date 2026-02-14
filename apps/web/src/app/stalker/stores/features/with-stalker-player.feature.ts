import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { DataService, PlaylistsService, StalkerSessionService } from 'services';
import { Playlist, STALKER_REQUEST, StalkerPortalActions } from 'shared-interfaces';
import { PlayerService } from '../../../services/player.service';
import { ContentType } from '../../../xtream/content-type.enum';
import { StalkerContentTypes } from '../../stalker-content-types';
import {
    normalizeStalkerEntityId,
    normalizeStalkerEntityIdAsNumber,
} from '../../stalker-vod.utils';
import { createLogger } from '../../../shared/utils/logger';

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
                playerService = inject(PlayerService),
                stalkerSession = inject(StalkerSessionService),
                snackBar = inject(MatSnackBar),
                translate = inject(TranslateService)
            ) => {
                const storeAny = store as any;
                const fetchLinkToPlayInternal = async (
                    portalUrl: string,
                    macAddress: string,
                    cmd: string,
                    series?: number
                ) => {
                    const type = series
                        ? ContentType.VODS
                        : storeAny.selectedContentType();

                    // Always use create_link to get the tokenized streaming URL
                    // The server adds the required token for playback authorization
                    // Note: cmd is already transformed during item processing (has_files items)
                    const params = {
                        action: StalkerContentTypes[
                            storeAny.selectedContentType()
                        ].getLink,
                        cmd: cmd,
                        type,
                        disable_ad: '0',
                        download: '0',
                        JsHttpRequest: '1-xml',
                        ...(series ? { series: String(series) } : {}),
                    };

                    // Use makeAuthenticatedRequest for automatic retry on auth failure
                    const playlist = storeAny.currentPlaylist() as Playlist;
                    let response: any;
                    if (playlist?.isFullStalkerPortal) {
                        // Full stalker portal - use authenticated request with retry
                        response = await stalkerSession.makeAuthenticatedRequest(
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

                    let url = response.js.cmd as string;

                    // If cmd is empty, the content is not available
                    if (!url) {
                        throw new Error('nothing_to_play');
                    }

                    if (url.startsWith('ffmpeg')) {
                        url = url.split(' ')[1];
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
                                        '/' + pathParts.slice(1, i + 1).join('/');
                                    break;
                                }
                            }

                            // If url starts with ?, it's just query params
                            // Combine with the original cmd path to form the complete streaming URL
                            if (url.startsWith('?')) {
                                // The streaming URL is: portal origin + base path + original cmd path + token query
                                // e.g., http://portal.com + /stalker_portal + /media/12345.mpg + ?token=xxx
                                url = `${portalUrlObj.origin}${basePath}${cmd}${url}`;
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
                    const playlist = storeAny.currentPlaylist() as Playlist;
                    if (!playlist) return null;

                    const queryParams = {
                        action: StalkerPortalActions.GetOrderedList,
                        type: 'vod',
                        movie_id: movieId,
                        p: '1',
                    };

                    let response: any;
                    if (playlist.isFullStalkerPortal) {
                        response = await stalkerSession.makeAuthenticatedRequest(
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

                const addToRecentlyViewedInternal = (
                    item: any,
                    cmd?: string,
                    cover?: string,
                    title?: string
                ) => {
                    const playlistId = storeAny.currentPlaylist()?._id;
                    if (!playlistId) return;
                    playlistService
                        .addPortalRecentlyViewed(playlistId, {
                            ...item,
                            id: item?.id,
                            cmd,
                            cover,
                            title,
                            category_id: storeAny.selectedContentType(),
                            added_at: Date.now(),
                        })
                        .subscribe();
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
                            const playlist = storeAny.currentPlaylist() as Playlist;
                            let response: any;
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

                                // Convert timestamp to readable date if it's a unix timestamp
                                if (expireDate && !isNaN(expireDate)) {
                                    const date = new Date(expireDate * 1000); // Convert seconds to milliseconds
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
                            const item = storeAny.selectedItem();
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

                            const playlist = storeAny.currentPlaylist();
                            const url = await fetchLinkToPlayInternal(
                                playlist.portalUrl,
                                playlist.macAddress,
                                cmdToUse,
                                episodeNum
                            );
                            if (typeof storeAny.addToRecentlyViewed === 'function') {
                                storeAny.addToRecentlyViewed({
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
                                episodeNum !== undefined ||
                                episodeId !== undefined;
                            const selectedItemId =
                                normalizeStalkerEntityIdAsNumber(item?.id) ?? 0;
                            const contentInfo = {
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
                            };

                            playerService.openPlayer(
                                url,
                                title,
                                thumbnail,
                                true,
                                false,
                                playlist?.userAgent,
                                playlist?.referrer,
                                playlist?.origin,
                                contentInfo,
                                startTime
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
