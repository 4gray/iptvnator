import {
    type PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    getLikelyBrowserUnsupportedCodecLabels,
} from '../playback-diagnostics/playback-diagnostics.util';

export type PlaybackDiagnosticDetail = {
    readonly labelKey: string;
    readonly value: string;
};

export function getDiagnosticTitleKey(issue: PlaybackDiagnostic): string {
    return `${getDiagnosticTranslationBase(issue)}.TITLE`;
}

export function getDiagnosticDescriptionKey(
    issue: PlaybackDiagnostic,
    supportsManagedExternalPlayers: boolean
): string {
    if (
        issue.code === PlaybackDiagnosticCode.BrowserAccessError &&
        !supportsManagedExternalPlayers
    ) {
        return 'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.PWA_DESCRIPTION';
    }

    return `${getDiagnosticTranslationBase(issue)}.DESCRIPTION`;
}

export function getDiagnosticMeta(issue: PlaybackDiagnostic): string {
    const codecs = [...issue.videoCodecs, ...issue.audioCodecs].join(', ');
    if (codecs) {
        return codecs;
    }

    return issue.container || issue.mimeType || '';
}

export function getDiagnosticCodecHint(issue: PlaybackDiagnostic): string {
    return getLikelyBrowserUnsupportedCodecLabels(issue).join(', ');
}

export function getDiagnosticDetails(
    issue: PlaybackDiagnostic
): readonly PlaybackDiagnosticDetail[] {
    return [
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_CODE',
            value: issue.code,
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_PLAYER',
            value: formatPlayer(issue.player),
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_SOURCE',
            value: formatDiagnosticSource(issue.source),
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_CONTAINER',
            value: issue.container,
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_MIME_TYPE',
            value: issue.mimeType ?? '',
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_VIDEO_CODECS',
            value: issue.videoCodecs.join(', '),
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_AUDIO_CODECS',
            value: issue.audioCodecs.join(', '),
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_NATIVE_ERROR_CODE',
            value: issue.nativeErrorCode?.toString() ?? '',
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_NATIVE_ERROR_MESSAGE',
            value: issue.nativeErrorMessage ?? '',
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
            value: issue.details ?? '',
        },
    ].filter(({ value }) => value.trim().length > 0);
}

function getDiagnosticTranslationBase(issue: PlaybackDiagnostic): string {
    switch (issue.code) {
        case PlaybackDiagnosticCode.UnsupportedContainer:
            return 'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CONTAINER';
        case PlaybackDiagnosticCode.UnsupportedCodec:
            return 'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CODEC';
        case PlaybackDiagnosticCode.MediaDecodeError:
            return 'PLAYBACK_DIAGNOSTICS.MEDIA_DECODE_ERROR';
        case PlaybackDiagnosticCode.NetworkError:
            return 'PLAYBACK_DIAGNOSTICS.NETWORK_ERROR';
        case PlaybackDiagnosticCode.BrowserAccessError:
            return 'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR';
        case PlaybackDiagnosticCode.DrmOrEncryption:
            return 'PLAYBACK_DIAGNOSTICS.DRM_OR_ENCRYPTION';
        case PlaybackDiagnosticCode.UnknownPlaybackError:
        default:
            return 'PLAYBACK_DIAGNOSTICS.UNKNOWN_PLAYBACK_ERROR';
    }
}

function formatPlayer(player: PlaybackDiagnostic['player']): string {
    switch (player) {
        case 'videojs':
            return 'Video.js';
        case 'html5':
            return 'HTML5';
        case 'artplayer':
            return 'ArtPlayer';
        default:
            return '';
    }
}

function formatDiagnosticSource(source: PlaybackDiagnostic['source']): string {
    switch (source) {
        case 'hls':
            return 'HLS.js';
        case 'mpegts':
            return 'mpegts.js';
        case 'native':
            return 'Native media element';
        case 'source':
            return 'Stream metadata';
        default:
            return source;
    }
}
