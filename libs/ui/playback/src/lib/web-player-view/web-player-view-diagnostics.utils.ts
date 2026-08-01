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
    if (issue.httpStatus !== undefined) {
        return `HTTP ${issue.httpStatus}`;
    }

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
            value:
                issue.vhs || issue.mpegTs || issue.shaka
                    ? ''
                    : (issue.nativeErrorMessage ?? ''),
        },
        {
            labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
            value: formatDiagnosticErrorDetails(issue),
        },
    ].filter(({ value }) => value.trim().length > 0);
}

function formatDiagnosticErrorDetails(issue: PlaybackDiagnostic): string {
    if (issue.mpegTs) {
        return [
            `stage=${issue.mpegTs.stage}`,
            `failure=${issue.mpegTs.failure}`,
            `type=${issue.mpegTs.engineType}`,
            `details=${issue.mpegTs.engineDetails}`,
            `disposition=${issue.mpegTs.disposition}`,
            issue.mpegTs.httpStatus === undefined
                ? ''
                : `HTTP ${issue.mpegTs.httpStatus}`,
        ]
            .filter((value) => value.length > 0)
            .join(' · ');
    }

    if (issue.shaka) {
        return [
            `stage=${issue.shaka.stage}`,
            `failure=${issue.shaka.failure}`,
            `severity=${issue.shaka.severity}`,
            `category=${issue.shaka.category}`,
            `code=${issue.shaka.engineCode}`,
            `disposition=${issue.shaka.disposition}`,
            issue.shaka.httpStatus === undefined
                ? ''
                : `HTTP ${issue.shaka.httpStatus}`,
        ]
            .filter((value) => value.length > 0)
            .join(' · ');
    }

    if (issue.vhs) {
        return [
            `stage=${issue.vhs.stage}`,
            `type=${issue.vhs.engineType}`,
            `code=${issue.vhs.mediaErrorCode}`,
            `disposition=${issue.vhs.disposition}`,
            issue.vhs.httpStatus === undefined
                ? ''
                : `HTTP ${issue.vhs.httpStatus}`,
        ]
            .filter((value) => value.length > 0)
            .join(' · ');
    }

    if (issue.hls) {
        return [
            `stage=${issue.hls.stage}`,
            `failure=${issue.hls.failure}`,
            `type=${issue.hls.engineType}`,
            `details=${issue.hls.engineDetails}`,
            `disposition=${issue.hls.disposition}`,
            issue.hls.httpStatus === undefined
                ? ''
                : `HTTP ${issue.hls.httpStatus}`,
        ]
            .filter((value) => value.length > 0)
            .join(' · ');
    }

    return [
        issue.httpStatus !== undefined ? `HTTP ${issue.httpStatus}` : '',
        issue.nativeErrorType ?? '',
        issue.details ?? '',
    ]
        .filter((value) => value.trim().length > 0)
        .join(' · ');
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
        case 'vhs':
            return 'Video.js / VHS';
        case 'hls':
            return 'HLS.js';
        case 'mpegts':
            return 'mpegts.js';
        case 'native':
            return 'Native media element';
        case 'shaka':
            return 'Shaka Player';
        case 'source':
            return 'Stream metadata';
        default:
            return source;
    }
}
