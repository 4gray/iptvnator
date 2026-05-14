import { getExtensionFromUrl } from 'm3u-utils';

import type {
    PlaybackSourceMetadata,
    PlaybackSourceMetadataInput,
} from './playback-diagnostics.model';

const UNSUPPORTED_CONTAINER_EXTENSIONS = new Set([
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

const UNSUPPORTED_CONTAINER_NAMES = new Set([
    ...UNSUPPORTED_CONTAINER_EXTENSIONS,
    'matroska',
    'quicktime',
    'x-matroska',
    'x-msvideo',
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

const BROWSER_LIMITED_CODEC_PATTERNS: ReadonlyArray<{
    readonly label: string;
    readonly pattern: RegExp;
}> = [
    { label: 'HEVC', pattern: /^(hev1|hvc1|hevc|h265)/ },
    { label: 'AC-3', pattern: /^(ac-?3|dac3)$/ },
    { label: 'E-AC-3', pattern: /^(ec-?3|eac-?3|dec3)$/ },
    { label: 'DTS', pattern: /^(dts|dtsc|dtse|dtsh|dtsl)/ },
    { label: 'MPEG-2 Video', pattern: /^(mp2v|mpeg2video)/ },
];

export function createPlaybackSourceMetadata(
    input: PlaybackSourceMetadataInput
): PlaybackSourceMetadata {
    const extension = getPlaybackMediaExtensionFromUrl(input.url);
    const mimeType = input.mimeType?.trim() || undefined;

    return {
        url: input.url,
        extension,
        container: extension || inferContainerFromMimeType(mimeType),
        mimeType,
        player: input.player,
        audioCodecs: normalizeCodecs(input.audioCodecs),
        videoCodecs: normalizeCodecs(input.videoCodecs),
    };
}

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

export function getLikelyBrowserUnsupportedCodecLabels(
    metadata: Pick<PlaybackSourceMetadata, 'audioCodecs' | 'videoCodecs'>
): string[] {
    const codecs = [...metadata.videoCodecs, ...metadata.audioCodecs].map(
        normalizeToken
    );

    return BROWSER_LIMITED_CODEC_PATTERNS.filter(({ pattern }) =>
        codecs.some((codec) => pattern.test(codec))
    ).map(({ label }) => label);
}

export function isLikelyContainerIssue(
    metadata: PlaybackSourceMetadata
): boolean {
    return (
        UNSUPPORTED_CONTAINER_NAMES.has(metadata.extension) ||
        UNSUPPORTED_CONTAINER_NAMES.has(metadata.container) ||
        metadata.mimeType === 'video/matroska'
    );
}

export function mergeCodecMetadata(
    metadata: PlaybackSourceMetadata,
    codecs: Pick<PlaybackSourceMetadataInput, 'audioCodecs' | 'videoCodecs'>
): PlaybackSourceMetadata {
    const audioCodecs = normalizeCodecs([
        ...metadata.audioCodecs,
        ...(codecs.audioCodecs ?? []),
    ]);
    const videoCodecs = normalizeCodecs([
        ...metadata.videoCodecs,
        ...(codecs.videoCodecs ?? []),
    ]);

    return {
        ...metadata,
        audioCodecs,
        videoCodecs,
    };
}

function inferContainerFromMimeType(mimeType: string | undefined): string {
    if (!mimeType) {
        return '';
    }

    const subtype = mimeType.split(';')[0]?.split('/')[1] ?? '';
    return subtype.toLowerCase();
}

function normalizeCodecs(codecs: readonly string[] | undefined): string[] {
    return Array.from(
        new Set(
            (codecs ?? [])
                .map((codec) => codec.trim())
                .filter((codec) => codec.length > 0)
        )
    );
}

function normalizeToken(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? '';
}

function normalizeExtensionToken(value: string | undefined): string {
    return normalizeToken(value).replace(/^\.+/, '');
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
