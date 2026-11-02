import type {
    CatchupDownloadMetadata,
    DownloadContentType,
    DownloadMetadataSnapshot,
    ElectronBridgeEpisodeIdentityScope,
} from '@iptvnator/shared/interfaces';
import { getPlaybackMediaExtensionFromUrl } from '@iptvnator/shared/m3u-utils';
import { assertDownloadMediaFile } from './download-media-file';

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

export function createFileName(title: string, url: string): string {
    const extension =
        getPlaybackMediaExtensionFromUrl(new URL(url).href) || 'mp4';
    const filename = `${sanitizeFilename(title)}.${extension}`;
    assertDownloadMediaFile(filename);
    return filename;
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
