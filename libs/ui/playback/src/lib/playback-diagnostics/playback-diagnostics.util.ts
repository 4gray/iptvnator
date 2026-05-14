import { getExtensionFromUrl } from 'm3u-utils';
import type {
    ExternalPlayerName,
    ResolvedPortalPlayback,
} from 'shared-interfaces';

export const PlaybackDiagnosticCode = {
    UnsupportedContainer: 'unsupported-container',
    UnsupportedCodec: 'unsupported-codec',
    MediaDecodeError: 'media-decode-error',
    NetworkError: 'network-error',
    BrowserAccessError: 'browser-access-error',
    DrmOrEncryption: 'drm-or-encryption',
    UnknownPlaybackError: 'unknown-playback-error',
} as const;

export type PlaybackDiagnosticCode =
    (typeof PlaybackDiagnosticCode)[keyof typeof PlaybackDiagnosticCode];

export const PlaybackDiagnosticSource = {
    Source: 'source',
    Native: 'native',
    Hls: 'hls',
    MpegTs: 'mpegts',
} as const;

export type PlaybackDiagnosticSource =
    (typeof PlaybackDiagnosticSource)[keyof typeof PlaybackDiagnosticSource];

export const InlinePlaybackPlayer = {
    VideoJs: 'videojs',
    Html5: 'html5',
    ArtPlayer: 'artplayer',
} as const;

export type InlinePlaybackPlayer =
    (typeof InlinePlaybackPlayer)[keyof typeof InlinePlaybackPlayer];

export interface PlaybackSourceMetadataInput {
    readonly url: string;
    readonly mimeType?: string;
    readonly player?: InlinePlaybackPlayer;
    readonly audioCodecs?: readonly string[];
    readonly videoCodecs?: readonly string[];
}

export interface PlaybackSourceMetadata {
    readonly url: string;
    readonly extension: string;
    readonly container: string;
    readonly mimeType?: string;
    readonly player?: InlinePlaybackPlayer;
    readonly audioCodecs: readonly string[];
    readonly videoCodecs: readonly string[];
}

export interface NativePlaybackErrorInput {
    readonly code?: number;
    readonly message?: string;
}

export interface HlsPlaybackErrorInput {
    readonly type?: string;
    readonly details?: string;
    readonly fatal?: boolean;
    readonly message?: string;
    readonly error?: unknown;
    readonly audioCodecs?: readonly string[];
    readonly videoCodecs?: readonly string[];
}

export interface MpegTsPlaybackErrorInput {
    readonly type?: string;
    readonly details?: string;
    readonly message?: string;
    readonly info?: unknown;
}

export interface PlaybackDiagnostic {
    readonly code: PlaybackDiagnosticCode;
    readonly source: PlaybackDiagnosticSource;
    readonly sourceUrl: string;
    readonly container: string;
    readonly mimeType?: string;
    readonly player?: InlinePlaybackPlayer;
    readonly audioCodecs: readonly string[];
    readonly videoCodecs: readonly string[];
    readonly details?: string;
    readonly nativeErrorCode?: number;
    readonly nativeErrorMessage?: string;
    readonly externalFallbackRecommended: boolean;
}

export interface PlaybackFallbackRequest {
    readonly player: ExternalPlayerName;
    readonly playback: ResolvedPortalPlayback;
    readonly diagnostic: PlaybackDiagnostic;
}

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

const DECLARED_MEDIA_EXTENSION_QUERY_KEYS = [
    'extension',
    'ext',
    'format',
    'container',
    'type',
    'output',
];

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
    'mpv',
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
    'php',
    'pl',
]);

const SOURCE_NOT_SUPPORTED_CODE = 4;
const DECODE_ERROR_CODE = 3;
const NETWORK_ERROR_CODE = 2;

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
    const pathExtension = normalizeExtensionToken(getExtensionFromUrl(url));
    if (DECLARED_MEDIA_EXTENSIONS.has(pathExtension)) {
        return pathExtension;
    }

    const queryExtension = getMediaExtensionFromQuery(url);
    if (queryExtension) {
        return queryExtension;
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

export function classifyNativePlaybackIssue(
    error: NativePlaybackErrorInput | MediaError | null | undefined,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    const nativeErrorCode = error?.code;
    const nativeErrorMessage = error?.message || undefined;
    const lowerNativeErrorMessage = nativeErrorMessage?.toLowerCase() ?? '';

    if (nativeErrorCode === NETWORK_ERROR_CODE) {
        return createDiagnostic({
            code: isBrowserAccessFailure(lowerNativeErrorMessage)
                ? PlaybackDiagnosticCode.BrowserAccessError
                : PlaybackDiagnosticCode.NetworkError,
            source: PlaybackDiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
        });
    }

    if (nativeErrorCode === DECODE_ERROR_CODE) {
        return createDiagnostic({
            code: PlaybackDiagnosticCode.MediaDecodeError,
            source: PlaybackDiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
        });
    }

    if (nativeErrorCode === SOURCE_NOT_SUPPORTED_CODE) {
        return createDiagnostic({
            code: isLikelyContainerIssue(metadata)
                ? PlaybackDiagnosticCode.UnsupportedContainer
                : PlaybackDiagnosticCode.UnsupportedCodec,
            source: PlaybackDiagnosticSource.Native,
            metadata,
            nativeErrorCode,
            nativeErrorMessage,
        });
    }

    return createDiagnostic({
        code: PlaybackDiagnosticCode.UnknownPlaybackError,
        source: PlaybackDiagnosticSource.Native,
        metadata,
        nativeErrorCode,
        nativeErrorMessage,
    });
}

export function classifyHlsPlaybackIssue(
    error: HlsPlaybackErrorInput,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    const details = normalizeErrorDetails(error);
    const lowerDetails = details.toLowerCase();
    const lowerType = (error.type ?? '').toLowerCase();
    const mergedMetadata = mergeCodecMetadata(metadata, {
        audioCodecs: error.audioCodecs,
        videoCodecs: error.videoCodecs,
    });

    if (isNetworkFailure(lowerType, lowerDetails)) {
        return createDiagnostic({
            code: isBrowserAccessFailure(lowerDetails)
                ? PlaybackDiagnosticCode.BrowserAccessError
                : PlaybackDiagnosticCode.NetworkError,
            source: PlaybackDiagnosticSource.Hls,
            metadata: mergedMetadata,
            details,
        });
    }

    if (isDrmOrEncryptionFailure(lowerDetails)) {
        return createDiagnostic({
            code: PlaybackDiagnosticCode.DrmOrEncryption,
            source: PlaybackDiagnosticSource.Hls,
            metadata: mergedMetadata,
            details,
        });
    }

    if (isCodecFailure(lowerDetails)) {
        return createDiagnostic({
            code: PlaybackDiagnosticCode.UnsupportedCodec,
            source: PlaybackDiagnosticSource.Hls,
            metadata: mergedMetadata,
            details,
        });
    }

    if (lowerType.includes('media') || lowerType.includes('mux')) {
        return createDiagnostic({
            code: PlaybackDiagnosticCode.MediaDecodeError,
            source: PlaybackDiagnosticSource.Hls,
            metadata: mergedMetadata,
            details,
        });
    }

    return createDiagnostic({
        code: PlaybackDiagnosticCode.UnknownPlaybackError,
        source: PlaybackDiagnosticSource.Hls,
        metadata: mergedMetadata,
        details,
    });
}

export function classifyMpegTsPlaybackIssue(
    error: MpegTsPlaybackErrorInput,
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic {
    const details = normalizeErrorDetails(error);
    const lowerDetails = details.toLowerCase();
    const lowerType = (error.type ?? '').toLowerCase();

    if (isNetworkFailure(lowerType, lowerDetails)) {
        return createDiagnostic({
            code: isBrowserAccessFailure(lowerDetails)
                ? PlaybackDiagnosticCode.BrowserAccessError
                : PlaybackDiagnosticCode.NetworkError,
            source: PlaybackDiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (lowerDetails.includes('codec')) {
        return createDiagnostic({
            code: PlaybackDiagnosticCode.UnsupportedCodec,
            source: PlaybackDiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (lowerDetails.includes('format') || lowerDetails.includes('mse')) {
        return createDiagnostic({
            code: PlaybackDiagnosticCode.UnsupportedContainer,
            source: PlaybackDiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    if (lowerType.includes('media')) {
        return createDiagnostic({
            code: PlaybackDiagnosticCode.MediaDecodeError,
            source: PlaybackDiagnosticSource.MpegTs,
            metadata,
            details,
        });
    }

    return createDiagnostic({
        code: PlaybackDiagnosticCode.UnknownPlaybackError,
        source: PlaybackDiagnosticSource.MpegTs,
        metadata,
        details,
    });
}

export function classifyUnsupportedHlsManifestCodecs(
    metadata: PlaybackSourceMetadata
): PlaybackDiagnostic | null {
    if (!hasCodecs(metadata) || typeof MediaSource === 'undefined') {
        return null;
    }

    const codecList = [...metadata.videoCodecs, ...metadata.audioCodecs];
    const mimeType = `video/mp4; codecs="${codecList.join(',')}"`;

    if (MediaSource.isTypeSupported(mimeType)) {
        return null;
    }

    return createDiagnostic({
        code: PlaybackDiagnosticCode.UnsupportedCodec,
        source: PlaybackDiagnosticSource.Source,
        metadata,
        details: mimeType,
    });
}

function createDiagnostic(options: {
    readonly code: PlaybackDiagnosticCode;
    readonly source: PlaybackDiagnosticSource;
    readonly metadata: PlaybackSourceMetadata;
    readonly details?: string;
    readonly nativeErrorCode?: number;
    readonly nativeErrorMessage?: string;
}): PlaybackDiagnostic {
    const {
        code,
        source,
        metadata,
        details,
        nativeErrorCode,
        nativeErrorMessage,
    } = options;

    return {
        code,
        source,
        sourceUrl: metadata.url,
        container: metadata.container,
        mimeType: metadata.mimeType,
        player: metadata.player,
        audioCodecs: metadata.audioCodecs,
        videoCodecs: metadata.videoCodecs,
        details: details || undefined,
        nativeErrorCode,
        nativeErrorMessage,
        externalFallbackRecommended: isExternalFallbackRecommended(code),
    };
}

function isExternalFallbackRecommended(code: PlaybackDiagnosticCode): boolean {
    return (
        code === PlaybackDiagnosticCode.UnsupportedContainer ||
        code === PlaybackDiagnosticCode.UnsupportedCodec ||
        code === PlaybackDiagnosticCode.MediaDecodeError ||
        code === PlaybackDiagnosticCode.BrowserAccessError ||
        code === PlaybackDiagnosticCode.DrmOrEncryption
    );
}

function mergeCodecMetadata(
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

function getMediaExtensionFromQuery(url: string): string {
    try {
        const parsedUrl = new URL(url, 'http://iptvnator.local');
        for (const key of DECLARED_MEDIA_EXTENSION_QUERY_KEYS) {
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

function inferContainerFromMimeType(mimeType: string | undefined): string {
    if (!mimeType) {
        return '';
    }

    const subtype = mimeType.split(';')[0]?.split('/')[1] ?? '';
    return subtype.toLowerCase();
}

function isLikelyContainerIssue(metadata: PlaybackSourceMetadata): boolean {
    return (
        UNSUPPORTED_CONTAINER_EXTENSIONS.has(metadata.extension) ||
        metadata.mimeType === 'video/matroska'
    );
}

function normalizeErrorDetails(
    error: HlsPlaybackErrorInput | MpegTsPlaybackErrorInput
): string {
    const hlsError = 'error' in error ? error.error : undefined;
    const mpegTsInfo = 'info' in error ? error.info : undefined;
    const errorMessage =
        hlsError instanceof Error
            ? hlsError.message
            : typeof hlsError === 'string'
              ? hlsError
              : '';
    const info =
        typeof mpegTsInfo === 'string'
            ? mpegTsInfo
            : mpegTsInfo
              ? JSON.stringify(mpegTsInfo)
              : '';

    return [error.details, error.message, errorMessage, info]
        .filter((part): part is string => Boolean(part))
        .join(' ');
}

function isNetworkFailure(type: string, details: string): boolean {
    return (
        type.includes('network') ||
        details.includes('network') ||
        details.includes('loaderror') ||
        details.includes('timeout') ||
        details.includes('status')
    );
}

function isBrowserAccessFailure(details: string): boolean {
    return (
        details.includes('cors') ||
        details.includes('cross-origin') ||
        details.includes('cross origin') ||
        details.includes('access-control') ||
        details.includes('access control') ||
        details.includes('content security policy') ||
        details.includes('mixed content') ||
        details.includes('private network access') ||
        details.includes('blocked by') ||
        details.includes('has been blocked') ||
        details.includes('not allowed to load local resource') ||
        details.includes('err_blocked') ||
        details.includes('err_cleartext')
    );
}

function isCodecFailure(details: string): boolean {
    return (
        details.includes('codec') ||
        details.includes('incompatiblecodecs') ||
        details.includes('addcodec')
    );
}

function isDrmOrEncryptionFailure(details: string): boolean {
    return (
        details.includes('decrypt') ||
        details.includes('keysystem') ||
        details.includes('keyload') ||
        details.includes('license') ||
        details.includes('drm')
    );
}

function hasCodecs(metadata: PlaybackSourceMetadata): boolean {
    return metadata.audioCodecs.length > 0 || metadata.videoCodecs.length > 0;
}
