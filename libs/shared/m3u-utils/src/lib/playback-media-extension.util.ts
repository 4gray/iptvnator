import { getExtensionFromUrl } from './playlist.utils';

/**
 * Normalized media-extension detection for playback URLs. Shared between the
 * player engines (engine selection in `@iptvnator/ui/playback`) and M3U
 * routing (`isDashChannel`), so both always agree on what a URL is.
 */

export const UNSUPPORTED_CONTAINER_EXTENSIONS = new Set([
    'avi',
    'asf',
    'divx',
    'flv',
    'm2ts',
    'm4v',
    'mkv',
    'mov',
    'mpeg',
    'mpg',
    'rm',
    'rmvb',
    'ts',
    'vob',
    'wmv',
]);

const EXPLICIT_MEDIA_EXTENSION_QUERY_KEYS = ['extension', 'ext'];

const DECLARED_MEDIA_FORMAT_QUERY_KEYS = ['format', 'container'];

const DECLARED_MEDIA_EXTENSION_ALIASES = new Map([
    ['hls', 'm3u8'],
    ['mpegts', 'ts'],
    ['mpeg-ts', 'ts'],
]);

const DECLARED_MEDIA_EXTENSIONS = new Set([
    ...UNSUPPORTED_CONTAINER_EXTENSIONS,
    'aac',
    'flac',
    'm3u',
    'm3u8',
    'm4s',
    'mp3',
    'mp4',
    'mpd',
    'oga',
    'ogg',
    'ogv',
    'webm',
]);

const NON_MEDIA_URL_EXTENSIONS = new Set([
    'asp',
    'aspx',
    'cgi',
    'jsp',
    'mpv',
    'php',
    'pl',
]);

export function getPlaybackMediaExtensionFromUrl(url: string): string {
    const explicitQueryExtension = getMediaExtensionFromQuery(
        url,
        EXPLICIT_MEDIA_EXTENSION_QUERY_KEYS
    );
    if (explicitQueryExtension) {
        return explicitQueryExtension;
    }

    const pathExtension = normalizeExtensionToken(getExtensionFromUrl(url));
    if (DECLARED_MEDIA_EXTENSIONS.has(pathExtension)) {
        return pathExtension;
    }

    const formatQueryExtension = getMediaExtensionFromQuery(
        url,
        DECLARED_MEDIA_FORMAT_QUERY_KEYS
    );
    if (formatQueryExtension) {
        return formatQueryExtension;
    }

    if (NON_MEDIA_URL_EXTENSIONS.has(pathExtension)) {
        return '';
    }

    return pathExtension;
}

function normalizeExtensionToken(value: string | undefined): string {
    return (value?.trim().toLowerCase() ?? '').replace(/^\.+/, '');
}

function getMediaExtensionFromQuery(
    url: string,
    queryKeys: readonly string[]
): string {
    try {
        const parsedUrl = new URL(url, 'http://iptvnator.local');
        for (const key of queryKeys) {
            const declaredExtension = normalizeDeclaredMediaExtension(
                parsedUrl.searchParams.get(key) ?? undefined
            );
            if (declaredExtension) {
                return declaredExtension;
            }
        }

        return '';
    } catch {
        return '';
    }
}

function normalizeDeclaredMediaExtension(value: string | undefined): string {
    const extension = normalizeExtensionToken(value);
    const normalized =
        DECLARED_MEDIA_EXTENSION_ALIASES.get(extension) ?? extension;

    if (!normalized || NON_MEDIA_URL_EXTENSIONS.has(normalized)) {
        return '';
    }

    return DECLARED_MEDIA_EXTENSIONS.has(normalized) ? normalized : '';
}
