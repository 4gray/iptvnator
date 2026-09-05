import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    createPlaylistObject,
    getFilenameFromUrl,
} from '@iptvnator/shared/m3u-utils';
import { parse } from 'iptv-playlist-parser';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createPlaylistAgentFactory } from '../util/secure-https';
import {
    createInvalidTlsCertificateError,
    getHostnameFromErrorUrl,
    isInvalidTlsCertificateError,
} from '../util/security-errors';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import type { M3uImportPerformanceCapture } from './playlist-import-performance';
import { M3U_IMPORT_PERFORMANCE_PHASE } from '@iptvnator/shared/interfaces';

export interface PlaylistFetchOptions {
    userAgent?: string;
    performanceCapture?: M3uImportPerformanceCapture | null;
    trustedInsecureTlsHosts?: readonly string[];
}

/**
 * Idle timeout for every playlist download hop. Without it a host that accepts
 * the connection and then goes silent keeps the request pending forever, which
 * stalled the unattended startup auto-update indefinitely (issue #931).
 * Mirrored by the playlist refresh worker.
 */
export const PLAYLIST_FETCH_TIMEOUT_MS = 30000;

function countPlaylistItems(value: unknown): number | undefined {
    try {
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        const items = Reflect.get(value, 'items');
        return Array.isArray(items) ? items.length : undefined;
    } catch {
        return undefined;
    }
}

function countNormalizedPlaylistItems(value: unknown): number | undefined {
    try {
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        return countPlaylistItems(Reflect.get(value, 'playlist'));
    } catch {
        return undefined;
    }
}

function readResponseContentLength(response: unknown): number | undefined {
    try {
        if (typeof response !== 'object' || response === null) {
            return undefined;
        }
        const headers = Reflect.get(response, 'headers');
        if (typeof headers !== 'object' || headers === null) {
            return undefined;
        }
        const directValue = Reflect.get(headers, 'content-length');
        const getHeader = Reflect.get(headers, 'get');
        const value =
            directValue ??
            (typeof getHeader === 'function'
                ? Reflect.apply(getHeader, headers, ['content-length'])
                : undefined);
        const numericValue =
            typeof value === 'number'
                ? value
                : typeof value === 'string' && value.trim().length > 0
                  ? Number(value)
                  : Number.NaN;
        return Number.isSafeInteger(numericValue) && numericValue >= 0
            ? numericValue
            : undefined;
    } catch {
        return undefined;
    }
}

export async function fetchPlaylistFromUrl(
    url: string,
    title?: string,
    options: PlaylistFetchOptions = {}
): Promise<Playlist> {
    const performanceCapture = options.performanceCapture;
    const userAgent = options.userAgent?.trim() || undefined;
    const request = () =>
        requestWithValidatedRedirects<string>(
            url,
            {
                agentFactory: createPlaylistAgentFactory({
                    trustedInsecureTlsHosts: options.trustedInsecureTlsHosts,
                }),
                method: 'GET',
                ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {}),
                timeout: PLAYLIST_FETCH_TIMEOUT_MS,
            },
            { allowPrivateNetworks: true }
        );
    let result;
    try {
        result = performanceCapture
            ? await performanceCapture.measureAsync(
                  M3U_IMPORT_PERFORMANCE_PHASE.DATA_ACQUIRE,
                  request,
                  (response) => ({
                      byteCount: readResponseContentLength(response),
                  })
              )
            : await request();
    } catch (error) {
        if (isInvalidTlsCertificateError(error)) {
            throw createInvalidTlsCertificateError(
                getHostnameFromErrorUrl(error, url)
            );
        }
        throw error;
    }

    const parsedPlaylist = performanceCapture
        ? performanceCapture.measure(
              M3U_IMPORT_PERFORMANCE_PHASE.PARSE_M3U,
              () => parse(result.data),
              (parsed) => ({ itemCount: countPlaylistItems(parsed) })
          )
        : parse(result.data);
    const normalize = (): Playlist => {
        const extractedName =
            url && url.length > 1 ? getFilenameFromUrl(url) : '';
        const playlistName =
            !extractedName || extractedName === 'Untitled playlist'
                ? 'Imported from URL'
                : extractedName;

        const playlist = createPlaylistObject(
            title ?? playlistName,
            parsedPlaylist,
            url,
            'URL'
        );
        if (userAgent) {
            playlist.userAgent = userAgent;
        }
        return playlist;
    };

    return performanceCapture
        ? performanceCapture.measure(
              M3U_IMPORT_PERFORMANCE_PHASE.NORMALIZE,
              normalize,
              (playlist) => ({
                  itemCount: countNormalizedPlaylistItems(playlist),
              })
          )
        : normalize();
}

export async function fetchPlaylistFromFile(
    filePath: string,
    title: string
): Promise<Playlist> {
    const fileContent = await readFile(filePath, 'utf-8');
    return createPlaylistObject(title, parse(fileContent), filePath, 'FILE');
}

export function derivePlaylistTitleFromFilePath(filePath: string): string {
    const filename = basename(filePath);
    return filename.replace(/\.(m3u8?|pls|txt)$/i, '') || 'from file';
}

export function preserveAutoUpdatedPlaylistFields(
    playlistObject: Playlist,
    playlist: Playlist
): Playlist {
    return {
        ...playlistObject,
        _id: playlist._id,
        autoRefresh: playlist.autoRefresh,
        favorites: playlist.favorites || [],
        userAgent: playlist.userAgent,
    };
}
