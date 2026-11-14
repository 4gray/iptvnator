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

/**
 * Leaves room for " (9999)", the media extension and ".part" inside the 255
 * byte name limit of APFS, ext4 and NTFS (UTF-8 bytes are never fewer than
 * the UTF-16 units NTFS counts).
 */
const MAX_STEM_BYTES = 200;
// Windows reserves a device name before the first dot: "CON.x.mp4" too.
// COM and LPT take 0-9 and the superscript digits ¹ ² ³ (Win32 file naming).
const WINDOWS_RESERVED_NAME =
    /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])\s*(?:\..*)?$/i;

function truncateUtf8(value: string, maxBytes: number): string {
    let bytes = 0;
    let result = '';
    for (const character of value) {
        bytes += Buffer.byteLength(character, 'utf8');
        if (bytes > maxBytes) break;
        result += character;
    }
    return result;
}

/**
 * The file-name stem for a provider title: path, control and reserved
 * characters replaced, capped in bytes, never empty and never a Windows
 * device name. A title the filesystem refuses would fail every retry.
 */
export function sanitizeFilename(name: string): string {
    const stem = truncateUtf8(
        // eslint-disable-next-line no-control-regex
        name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim(),
        MAX_STEM_BYTES
    ).trim();
    if (!stem) return 'download';
    return WINDOWS_RESERVED_NAME.test(stem) ? `_${stem}` : stem;
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
