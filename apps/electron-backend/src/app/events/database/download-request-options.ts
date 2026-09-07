import type {
    CatchupDownloadMetadata,
    DownloadContentType,
    DownloadMetadataSnapshot,
    ElectronBridgeEpisodeIdentityScope,
} from '@iptvnator/shared/interfaces';
import { extname } from 'node:path';

export interface StartDownloadRequest {
    playlistId: string;
    xtreamId: number;
    contentType: DownloadContentType;
    catchup?: CatchupDownloadMetadata | null;
    title: string;
    url: string;
    posterUrl?: string;
    metadataSnapshot?: DownloadMetadataSnapshot;
    downloadFolder: string;
    headers?: { userAgent?: string; referer?: string; origin?: string };
    seriesXtreamId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    episodeIdentityScope?: ElectronBridgeEpisodeIdentityScope;
    playlistName?: string;
    playlistType?: 'xtream' | 'stalker' | 'm3u-file' | 'm3u-text' | 'm3u-url';
    serverUrl?: string;
    portalUrl?: string;
    macAddress?: string;
}

export function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

function getExtensionFromUrl(url: string): string {
    try {
        // Sanitize too: URL pathnames may legally contain characters like ':'
        // that would create NTFS alternate data streams on Windows.
        const extension = sanitizeFilename(extname(new URL(url).pathname));
        return extension.startsWith('.') ? extension : '.mp4';
    } catch {
        return '.mp4';
    }
}

export function createFileName(title: string, url: string): string {
    return sanitizeFilename(title) + getExtensionFromUrl(url);
}

export function createHeaders(
    headers: StartDownloadRequest['headers']
): Record<string, string> | undefined {
    if (!headers) {
        return undefined;
    }

    const result: Record<string, string> = {};
    if (headers.userAgent) {
        result['User-Agent'] = headers.userAgent;
    }
    if (headers.origin) {
        result.Origin = headers.origin;
    }
    if (headers.referer) {
        result.Referer = headers.referer;
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

export function serializeHeaders(
    headers: Record<string, string> | undefined
): string | null {
    return headers ? JSON.stringify(headers) : null;
}
