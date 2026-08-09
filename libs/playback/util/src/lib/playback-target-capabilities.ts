import {
    InlinePlaybackPlayer,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
} from './diagnostics/playback-diagnostics.model';
import {
    PlaybackEngineFamily,
    PlaybackSourceKind,
    type PlaybackTargetCapability,
} from './playback-recommendation.model';

const HLS_MIME_TYPES = new Set([
    'application/vnd.apple.mpegurl',
    'application/x-mpegurl',
    'audio/x-mpegurl',
]);
const DASH_MIME_TYPE = 'application/dash+xml';

export function resolvePlaybackSourceKind(
    diagnostic: PlaybackDiagnostic
): PlaybackSourceKind {
    switch (diagnostic.source) {
        // Engine-specific sources identify the boundary that emitted the
        // failure, so generic container/MIME metadata cannot override them.
        case PlaybackDiagnosticSource.Hls:
            return PlaybackSourceKind.Hls;
        case PlaybackDiagnosticSource.MpegTs:
            return PlaybackSourceKind.MpegTs;
        case PlaybackDiagnosticSource.Shaka:
            return PlaybackSourceKind.Dash;
        case PlaybackDiagnosticSource.Source:
        case PlaybackDiagnosticSource.Vhs:
            return resolveSourceOrVhsKind(diagnostic);
        case PlaybackDiagnosticSource.Native:
            return PlaybackSourceKind.Native;
        default:
            return PlaybackSourceKind.Unknown;
    }
}

export function getInlinePlaybackEngineFamily(
    sourceKind: PlaybackSourceKind,
    target: InlinePlaybackPlayer
): PlaybackEngineFamily | null {
    switch (sourceKind) {
        case PlaybackSourceKind.Hls:
            return target === InlinePlaybackPlayer.VideoJs
                ? PlaybackEngineFamily.Vhs
                : PlaybackEngineFamily.HlsJs;
        case PlaybackSourceKind.MpegTs:
            return PlaybackEngineFamily.MpegTsJs;
        case PlaybackSourceKind.Dash:
            return target === InlinePlaybackPlayer.VideoJs
                ? null
                : PlaybackEngineFamily.Shaka;
        case PlaybackSourceKind.Native:
            return PlaybackEngineFamily.NativeMedia;
        case PlaybackSourceKind.Unknown:
        default:
            return null;
    }
}

export function createPlaybackTargetCapabilities(options: {
    readonly sourceKind: PlaybackSourceKind;
    readonly managedExternalPlayersAvailable: boolean;
}): readonly PlaybackTargetCapability[] {
    const inlineTargets = [
        InlinePlaybackPlayer.VideoJs,
        InlinePlaybackPlayer.Html5,
        InlinePlaybackPlayer.ArtPlayer,
    ] as const;
    const inlineCapabilities = inlineTargets.map((target) => {
        const engineFamily = getInlinePlaybackEngineFamily(
            options.sourceKind,
            target
        );
        return {
            kind: 'inline' as const,
            target,
            available: engineFamily !== null,
            engineFamily,
        };
    });

    return [
        ...inlineCapabilities,
        {
            kind: 'external',
            target: 'mpv',
            available: options.managedExternalPlayersAvailable,
        },
        {
            kind: 'external',
            target: 'vlc',
            available: options.managedExternalPlayersAvailable,
        },
    ];
}

function resolveSourceOrVhsKind(
    diagnostic: PlaybackDiagnostic
): PlaybackSourceKind {
    const containerKind = resolveContainerKind(diagnostic.container);
    const mimeTypeKind = resolveMimeTypeKind(diagnostic.mimeType);

    if (
        containerKind !== null &&
        mimeTypeKind !== null &&
        containerKind !== mimeTypeKind
    ) {
        return PlaybackSourceKind.Unknown;
    }

    return containerKind ?? mimeTypeKind ?? PlaybackSourceKind.Unknown;
}

function resolveContainerKind(container: string): PlaybackSourceKind | null {
    if (container === 'm3u' || container === 'm3u8') {
        return PlaybackSourceKind.Hls;
    }
    return container === 'mpd' ? PlaybackSourceKind.Dash : null;
}

function resolveMimeTypeKind(
    mimeType: string | undefined
): PlaybackSourceKind | null {
    const baseMimeType = mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (HLS_MIME_TYPES.has(baseMimeType)) {
        return PlaybackSourceKind.Hls;
    }
    return baseMimeType === DASH_MIME_TYPE ? PlaybackSourceKind.Dash : null;
}
