import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signalStoreFeature, withMethods } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from 'm3u-state';
import { PORTAL_PLAYER, createLogger } from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService } from 'services';
import {
    Playlist,
    PlaylistMeta,
    ResolvedPortalPlayback,
    STALKER_REQUEST,
    StalkerPortalActions,
    StalkerPortalItem,
} from 'shared-interfaces';
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

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === 'string') {
        return error;
    }

    return '';
}

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
                const storeState = store as unknown as StalkerPlayerStoreLike;

                const normalizeCmdValue = (value: string): string => {
                    const trimmed = String(value ?? '').trim();
                    if (!trimmed) return '';

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

                const resolvePortalBasePath = (
                    portalUrl: string
                ): {
                    origin: string;
                    basePath: string;
                } | null => {
                    try {
                        const portalUrlObj = new URL(portalUrl);
                        const pathParts = portalUrlObj.pathname.split('/');
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

                        return {
                            origin: portalUrlObj.origin,
                            basePath,
                        };
                    } catch {
                        return null;
                    }
                };

                const buildDirectStreamUrl = (
                    portalUrl: string,
                    value?: string,
                    originalCmd?: string
                ): string => {
                    const normalizedValue = normalizeCmdValue(
                        String(value ?? '')
                    );
                    if (!normalizedValue) {
                        return '';
                    }

                    if (
                        normalizedValue.startsWith('http://') ||
                        normalizedValue.startsWith('https://')
                    ) {
                        return normalizedValue;
                    }

                    const portalBase = resolvePortalBasePath(portalUrl);
                    if (!portalBase) {
                        return normalizedValue;
                    }

                    const { origin, basePath } = portalBase;
                    const normalizedOriginalCmd = normalizeCmdValue(
                        String(originalCmd ?? value ?? '')
                    );

                    if (normalizedValue.startsWith('?')) {
                        if (
                            normalizedOriginalCmd.startsWith('http://') ||
                            normalizedOriginalCmd.startsWith('https://')
                        ) {
                            return `${normalizedOriginalCmd}${normalizedValue}`;
                        }

                        const originalPath = normalizedOriginalCmd.startsWith(
                            '/'
                        )
                            ? normalizedOriginalCmd
                            : `${basePath}/${normalizedOriginalCmd}`.replace(
                                /\/{2,}/g,
                                '/'
                            );

                        return `${origin}${originalPath}${normalizedValue}`;
                    }

                    if (normalizedValue.startsWith('/')) {
                        if (
                            basePath &&
                            normalizedValue !== basePath &&
                            !normalizedValue.startsWith(`${basePath}/`)
                        ) {
                            return `${origin}${basePath}${normalizedValue}`;
                        }

                        return `${origin}${normalizedValue}`;
                    }

                    const baseHref = basePath
                        ? `${origin}${basePath}/`
                        : `${origin}/`;

                    try {
                        return new URL(normalizedValue, baseHref).toString();
                    } catch {
                        return `${baseHref}${normalizedValue}`.replace(
                            /([^:]\/)\/+/g,
                            '$1'
                        );
                    }
                };

                const looksLikeDirectStreamCommand = (value?: string): boolean => {
                    const normalized = normalizeCmdValue(String(value ?? ''));
                    if (!normalized) {
                        return false;
                    }

                    if (
                        normalized.startsWith('http://') ||
                        normalized.startsWith('https://')
                    ) {
                        return true;
                    }

                    if (normalized.includes('/media/')) {
                        return true;
                    }

                    if (/\.(mpg|mpeg|ts|m3u8|mp4|mkv|avi)(\?|$)/i.test(normalized)) {
                        return true;
                    }

                    return false;
                };

                const fetchLinkToPlayInternal = async (
                    portalUrl: string,
                    macAddress: string,
                    cmd: string,
                    series?: number,
                    forcedContentType?: StalkerContentType
                ): Promise<string> => {
                    const playlist = storeState.currentPlaylist();
                    const selectedContentType =
                        forcedContentType ?? storeState.selectedContentType();
                    const type = series ? 'vod' : selectedContentType;

                    const directUrlCandidate = buildDirectStreamUrl(
                        portalUrl,
                        cmd,
                        cmd
                    );

                    const canUseDirectUrl =
                        selectedContentType !== 'itv' &&
                        looksLikeDirectStreamCommand(cmd) &&
                        !!directUrlCandidate;

                    // Primeiro tenta o caminho mais direto quando o cmd já
                    // parece um stream válido.
                    if (canUseDirectUrl) {
                        return directUrlCandidate;
                    }

                    const params = {
                        action: StalkerContentTypes[selectedContentType]
                            .getLink,
                        cmd,
                        type,
                        disable_ad: '0',
                        download: '0',
                        JsHttpRequest: '1-xml',
                        ...(series ? { series: String(series) } : {}),
                    };

                    let response: StalkerResponse;

                    try {
                        if (playlist?.isFullStalkerPortal) {
                            response =
                                await stalkerSession.makeAuthenticatedRequest(
                                    playlist,
                                    params
                                );
                        } else {
                            response = await dataService.sendIpcEvent(
                                STALKER_REQUEST,
                                {
                                    url: portalUrl,
                                    macAddress,
                                    params,
                                    customPortalKey: playlist?.customPortalKey,
                                }
                            );
                        }
                    } catch (error) {
                        // Se create_link falhar, mas o cmd parece stream direto,
                        // cai para o fallback.
                        if (directUrlCandidate && looksLikeDirectStreamCommand(cmd)) {
                            logger.warn(
                                'create_link failed, falling back to direct stream URL',
                                {
                                    cmd,
                                    selectedContentType,
                                    series,
                                }
                            );
                            return directUrlCandidate;
                        }

                        throw error;
                    }

                    if (response.js?.error) {
                        if (directUrlCandidate && looksLikeDirectStreamCommand(cmd)) {
                            return directUrlCandidate;
                        }

                        logger.error('Server error', response.js.error);
                        throw new Error(response.js.error);
                    }

                    let url = normalizeCmdValue(response.js?.cmd ?? '');

                    if (!url) {
                        if (directUrlCandidate && looksLikeDirectStreamCommand(cmd)) {
                            return directUrlCandidate;
                        }

                        throw new Error('nothing_to_play');
                    }

                    if (
                        !url.startsWith('http://') &&
                        !url.startsWith('https://')
                    ) {
                        url = buildDirectStreamUrl(portalUrl, url, cmd);
                    }

                    return url;
                };

                const fetchMovieFileIdInternal = async (
                    movieId: string
                ): Promise<string | null> => {
                    const playlist = storeState.currentPlaylist();
                    if (!playlist) {
                        return null;
                    }

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
                                customPortalKey: playlist.customPortalKey,
                            }
                        );
                    }

                    if (response?.js?.data?.[0]?.id) {
                        return String(response.js.data[0].id);
                    }

                    return null;
                };

                const addToRecentlyViewedInternal = (
                    item: StalkerPlayableItem | null,
                    cmd?: string,
                    cover?: string,
                    title?: string
                ): void => {
                    const playlistId = storeState.currentPlaylist()?._id;
                    if (!playlistId || !item) {
                        return;
                    }

                    const recentlyViewedItem: {
                        id: string;
                        title: string;
                    } & Record<string, unknown> = {
                        ...item,
                        id: normalizeStalkerEntityId(item.id),
                        cmd,
                        cover,
                        title: title ?? item.title ?? item.name ?? '',
                        category_id: storeState.selectedContentType(),
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

                    if (
                        item?.has_files !== undefined &&
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
                        if (item) {
                            storeState.addToRecentlyViewed({
                                ...item,
                                id: item.id,
                                cmd,
                                cover: thumbnail,
                                title,
                            });
                        }
                    } else {
                        addToRecentlyViewedInternal(item, cmd, thumbnail, title);
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

                return {
                    async fetchLinkToPlay(
                        portalUrl: string,
                        macAddress: string,
                        cmd: string,
                        series?: number
                    ): Promise<string> {
                        return fetchLinkToPlayInternal(
                            portalUrl,
                            macAddress,
                            cmd,
                            series
                        );
                    },

                    async getExpireDate(): Promise<string> {
                        const params = {
                            type: 'account_info',
                            action: 'get_main_info',
                            JsHttpRequest: '1-xml',
                        };

                        try {
                            const playlist = storeState.currentPlaylist();
                            let response: StalkerResponse;

                            if (!playlist) {
                                return 'Unknown';
                            }

                            if (playlist.isFullStalkerPortal) {
                                response =
                                    await stalkerSession.makeAuthenticatedRequest(
                                        playlist,
                                        params
                                    );
                            } else {
                                response = await dataService.sendIpcEvent(
                                    STALKER_REQUEST,
                                    {
                                        url: playlist.portalUrl,
                                        macAddress: playlist.macAddress,
                                        params,
                                        customPortalKey: playlist.customPortalKey,
                                    }
                                );
                            }

                            if (response?.js?.account_info) {
                                const expireDate =
                                    response.js.account_info.expire_date;
                                const numericExpireDate = Number(expireDate);

                                if (
                                    expireDate &&
                                    !Number.isNaN(numericExpireDate)
                                ) {
                                    const date = new Date(
                                        numericExpireDate * 1000
                                    );
                                    return date.toLocaleDateString();
                                }

                                return String(expireDate ?? 'Unknown');
                            }

                            return 'Unknown';
                        } catch (error) {
                            logger.error('Failed to fetch expire date', error);
                            return 'Error fetching data';
                        }
                    },

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

                    async createLinkToPlayVod(
                        cmd?: string,
                        title?: string,
                        thumbnail?: string,
                        episodeNum?: number,
                        episodeId?: number,
                        startTime?: number
                    ): Promise<void> {
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
                                getErrorMessage(error) === 'nothing_to_play'
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