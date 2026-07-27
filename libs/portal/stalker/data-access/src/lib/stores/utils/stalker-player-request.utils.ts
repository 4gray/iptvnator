import { DataService } from '@iptvnator/services';
import {
    PlaylistMeta,
    STALKER_SESSION_APPLICATION_OPERATIONS,
    StalkerPlaybackContextRef,
    StalkerPortalActions,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { StalkerContentTypes } from '../../stalker-content-types';
import { StalkerContentType } from '../stalker-store.contracts';
import {
    executeStalkerRequest,
    toStalkerSessionPlaylist,
} from './stalker-request.utils';

export interface StalkerPlayerResponse {
    js?: {
        error?: string;
        cmd?: string;
        data?: Array<{ id?: string | number }>;
        account_info?: {
            expire_date?: string | number;
        };
    };
}

export interface StalkerPlayerRequestDeps {
    dataService: DataService;
    stalkerSession: StalkerSessionService;
}

export interface StalkerPlaybackLink {
    streamUrl: string;
    playbackContextRef?: StalkerPlaybackContextRef;
}

export interface StalkerPlayableItemLike extends StalkerPortalItem {
    cmd?: string;
    has_files?: unknown;
}

export function normalizeStalkerPlaybackCommand(value: string): string {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) {
        return '';
    }

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
}

export function resolveStalkerPlaybackUrl(
    portalUrl: string,
    originalCmd: string,
    responseCmd: string
): string {
    const url = normalizeStalkerPlaybackCommand(responseCmd);
    if (!url) {
        return '';
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }

    try {
        const portalUrlObj = new URL(portalUrl);
        const pathParts = portalUrlObj.pathname.split('/');
        let basePath = '';

        for (let index = 0; index < pathParts.length; index += 1) {
            if (
                pathParts[index] === 'stalker_portal' ||
                pathParts[index] === 'c' ||
                pathParts[index] === 'portal'
            ) {
                basePath = '/' + pathParts.slice(1, index + 1).join('/');
                break;
            }
        }

        if (url.startsWith('?')) {
            const normalizedCmd = normalizeStalkerPlaybackCommand(originalCmd);
            if (
                normalizedCmd.startsWith('http://') ||
                normalizedCmd.startsWith('https://')
            ) {
                return `${normalizedCmd}${url}`;
            }

            return `${portalUrlObj.origin}${basePath}${normalizedCmd}${url}`;
        }

        if (url.startsWith('/')) {
            return `${portalUrlObj.origin}${basePath}${url}`;
        }
    } catch {
        return url;
    }

    return url;
}

export function shouldResolveMovieFileId(
    item: Pick<StalkerPlayableItemLike, 'has_files'> | null | undefined,
    cmd: string
): boolean {
    return (
        item?.has_files !== undefined &&
        !cmd.includes('://') &&
        cmd.includes('/media/') &&
        !cmd.includes('/media/file_')
    );
}

/**
 * String-only compatibility path retained for downloads. Playback callers
 * must use {@link fetchStalkerPlayback} so the opaque context reaches native
 * playback. Authenticated full-portal downloads need a separate main-owned
 * download-context contract before this compatibility method can be removed.
 */
export async function fetchStalkerPlaybackLink(
    deps: StalkerPlayerRequestDeps,
    options: {
        playlist: PlaylistMeta;
        selectedContentType: StalkerContentType;
        cmd: string;
        series?: number;
        forcedContentType?: StalkerContentType;
    }
): Promise<string> {
    return (await fetchStalkerPlayback(deps, options)).streamUrl;
}

export async function fetchStalkerPlayback(
    deps: StalkerPlayerRequestDeps,
    options: {
        playlist: PlaylistMeta;
        selectedContentType: StalkerContentType;
        cmd: string;
        series?: number;
        forcedContentType?: StalkerContentType;
    }
): Promise<StalkerPlaybackLink> {
    const contentType =
        options.forcedContentType ?? options.selectedContentType;
    if (
        options.playlist.isFullStalkerPortal &&
        supportsTypedSessions(deps.stalkerSession)
    ) {
        const isEpisode = options.series !== undefined;
        const payload = await deps.stalkerSession.requestForPlaylist(
            toStalkerSessionPlaylist(options.playlist),
            STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
            {
                contentType: isEpisode ? 'episode' : contentType,
                command: options.cmd,
                ...(isEpisode
                    ? { episodeNumber: options.series as number }
                    : {}),
            }
        );
        if (!payload.playbackContextRef) {
            throw new Error('stalker-playback-context-missing');
        }

        return normalizePlaybackLink(
            options.playlist.portalUrl ?? '',
            options.cmd,
            payload.streamUrl,
            payload.playbackContextRef
        );
    }

    const response = await executeStalkerRequest<StalkerPlayerResponse>(
        deps,
        options.playlist,
        {
            action: StalkerContentTypes[contentType].getLink,
            cmd: options.cmd,
            type: options.series ? 'vod' : contentType,
            disable_ad: '0',
            download: '0',
            JsHttpRequest: '1-xml',
            ...(options.series ? { series: String(options.series) } : {}),
        }
    );

    if (response.js?.error) {
        throw new Error(response.js.error);
    }

    return normalizePlaybackLink(
        options.playlist.portalUrl ?? '',
        options.cmd,
        response.js?.cmd ?? ''
    );
}

function normalizePlaybackLink(
    portalUrl: string,
    originalCmd: string,
    responseCmd: string,
    playbackContextRef?: StalkerPlaybackContextRef
): StalkerPlaybackLink {
    const streamUrl = resolveStalkerPlaybackUrl(
        portalUrl,
        originalCmd,
        responseCmd
    );
    if (!streamUrl) {
        throw new Error('nothing_to_play');
    }

    return {
        streamUrl,
        ...(playbackContextRef ? { playbackContextRef } : {}),
    };
}

function supportsTypedSessions(stalkerSession: StalkerSessionService): boolean {
    const probe = (
        stalkerSession as Partial<
            Pick<StalkerSessionService, 'supportsTypedSessions'>
        >
    ).supportsTypedSessions;
    return typeof probe !== 'function' || probe.call(stalkerSession);
}

export async function fetchStalkerMovieFileId(
    deps: StalkerPlayerRequestDeps,
    playlist: PlaylistMeta,
    movieId: string
): Promise<string | null> {
    if (
        playlist.isFullStalkerPortal &&
        supportsTypedSessions(deps.stalkerSession)
    ) {
        const result = await deps.stalkerSession.requestForPlaylist(
            toStalkerSessionPlaylist(playlist),
            STALKER_SESSION_APPLICATION_OPERATIONS.CatalogItems,
            {
                contentType: 'vod',
                itemId: movieId,
                page: 1,
            }
        );
        const fileId = result.items[0]?.id;
        return fileId == null ? null : String(fileId);
    }

    const response = await executeStalkerRequest<StalkerPlayerResponse>(
        deps,
        playlist,
        {
            action: StalkerPortalActions.GetOrderedList,
            type: 'vod',
            movie_id: movieId,
            p: '1',
        }
    );

    const fileId = response?.js?.data?.[0]?.id;
    return fileId == null ? null : String(fileId);
}

export async function fetchStalkerExpireDate(
    deps: StalkerPlayerRequestDeps,
    playlist: PlaylistMeta
): Promise<string> {
    const response = await executeStalkerRequest<StalkerPlayerResponse>(
        deps,
        playlist,
        {
            type: 'account_info',
            action: 'get_main_info',
            JsHttpRequest: '1-xml',
        }
    );

    const expireDate = response?.js?.account_info?.expire_date;
    const numericExpireDate = Number(expireDate);

    if (expireDate && !Number.isNaN(numericExpireDate)) {
        return new Date(numericExpireDate * 1000).toLocaleDateString();
    }

    return expireDate ? String(expireDate) : 'Unknown';
}
