import {
    UNSUPPORTED_CONTAINER_EXTENSIONS,
    getPlaybackMediaExtensionFromUrl,
} from '@iptvnator/shared/m3u-utils';

import type {
    PlaybackSourceMetadata,
    PlaybackSourceMetadataInput,
} from './playback-diagnostics.model';

// Media-extension normalization lives in @iptvnator/shared/m3u-utils so M3U
// routing (isDashChannel) and engine selection always agree; re-exported here
// to keep the playback-lib import surface stable.
export { getPlaybackMediaExtensionFromUrl };

const UNSUPPORTED_CONTAINER_NAMES = new Set([
    ...UNSUPPORTED_CONTAINER_EXTENSIONS,
    'matroska',
    'quicktime',
    'x-matroska',
    'x-msvideo',
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
