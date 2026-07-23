import {
    Channel,
    ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    PlaybackDiagnostic,
    PlaybackDiagnosticCode,
} from '../playback-diagnostics/playback-diagnostics.util';

export function isLivePlayback(playback: ResolvedPortalPlayback): boolean {
    return typeof playback.isLive === 'boolean'
        ? playback.isLive
        : !playback.contentInfo;
}

export function isInlinePlayer(player: VideoPlayer): boolean {
    return [
        VideoPlayer.VideoJs,
        VideoPlayer.Html5Player,
        VideoPlayer.ArtPlayer,
        VideoPlayer.EmbeddedMpv,
    ].includes(player);
}

export function toPlaybackChannel(playback: ResolvedPortalPlayback): Channel {
    return {
        id: playback.streamUrl,
        url: playback.streamUrl,
        name: playback.title || playback.streamUrl,
        group: { title: '' },
        tvg: {
            id: '',
            name: playback.title || playback.streamUrl,
            url: '',
            logo: playback.thumbnail ?? '',
            rec: '',
        },
        http: {
            referrer:
                playback.referer ??
                getHeaderValue(playback.headers, 'Referer') ??
                '',
            'user-agent':
                playback.userAgent ??
                getHeaderValue(playback.headers, 'User-Agent') ??
                '',
            origin:
                playback.origin ??
                getHeaderValue(playback.headers, 'Origin') ??
                '',
        },
        radio: 'false',
    };
}

export function diagnosticTranslationBase(issue: PlaybackDiagnostic): string {
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
        default:
            return 'PLAYBACK_DIAGNOSTICS.UNKNOWN_PLAYBACK_ERROR';
    }
}

export function formatDiagnosticPlayer(
    player: PlaybackDiagnostic['player']
): string {
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

export function formatDiagnosticSource(
    source: PlaybackDiagnostic['source']
): string {
    return (
        {
            hls: 'HLS.js',
            mpegts: 'mpegts.js',
            native: 'Native media element',
            source: 'Stream metadata',
        }[source] ?? source
    );
}

function getHeaderValue(
    headers: ResolvedPortalPlayback['headers'] | undefined,
    name: string
): string | undefined {
    const matchingKey = Object.keys(headers ?? {}).find(
        (key) => key.toLowerCase() === name.toLowerCase()
    );
    return matchingKey ? headers?.[matchingKey] : undefined;
}
