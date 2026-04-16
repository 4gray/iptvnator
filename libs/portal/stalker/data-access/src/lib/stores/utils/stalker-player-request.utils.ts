import { DataService } from 'services';
import {
    PlaylistMeta,
    StalkerPortalActions,
    StalkerPortalItem,
} from 'shared-interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { StalkerContentTypes } from '../../stalker-content-types';
import { StalkerContentType } from '../stalker-store.contracts';
import { executeStalkerRequest } from './stalker-request.utils';

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
    let url = normalizeStalkerPlaybackCommand(responseCmd);
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
    const contentType =
        options.forcedContentType ?? options.selectedContentType;
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

    const streamUrl = resolveStalkerPlaybackUrl(
        options.playlist.portalUrl ?? '',
        options.cmd,
        response.js?.cmd ?? ''
    );

    if (!streamUrl) {
        throw new Error('nothing_to_play');
    }

    return streamUrl;
}

export async function fetchStalkerMovieFileId(
    deps: StalkerPlayerRequestDeps,
    playlist: PlaylistMeta,
    movieId: string
): Promise<string | null> {
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
