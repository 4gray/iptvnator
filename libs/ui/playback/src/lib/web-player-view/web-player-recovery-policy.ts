import {
    InlinePlaybackPlayer,
    createPlaybackTargetCapabilities,
    recommendPlaybackRecovery,
    resolvePlaybackSourceKind,
    type PlaybackDiagnostic,
    type PlaybackRecommendation,
    type PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import {
    VideoPlayer,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { PlaybackBinding } from './playback-recovery-session';

export function createWebPlayerRecommendations(options: {
    readonly diagnostic: PlaybackDiagnostic | null;
    readonly binding: PlaybackBinding | null;
    readonly attemptedTargets: ReadonlySet<PlaybackRecommendationTarget>;
    readonly managedExternalPlayersAvailable: boolean;
    readonly playbackExternallyTransferable: boolean;
    readonly isLive: boolean;
    readonly alternativeSourceCount: number;
}): readonly PlaybackRecommendation[] {
    if (!options.diagnostic || !options.binding) {
        return [];
    }
    const sourceKind = resolvePlaybackSourceKind(options.diagnostic);
    return recommendPlaybackRecovery({
        diagnostic: options.diagnostic,
        activeTarget: options.binding.target,
        attemptedTargets: options.attemptedTargets,
        targetCapabilities: createPlaybackTargetCapabilities({
            sourceKind,
            managedExternalPlayersAvailable:
                options.managedExternalPlayersAvailable,
        }),
        source: {
            kind: sourceKind,
            isLive: options.isLive,
            drm: options.playbackExternallyTransferable
                ? 'none'
                : 'untransferable',
            externalTransferable: options.playbackExternallyTransferable,
        },
        alternativeSourceCount: options.alternativeSourceCount,
    });
}

export function isPlaybackExternallyTransferable(
    playback: ResolvedPortalPlayback
): boolean {
    return playback.drm === undefined;
}

export function toVideoPlayer(target: InlinePlaybackPlayer): VideoPlayer {
    switch (target) {
        case InlinePlaybackPlayer.VideoJs:
            return VideoPlayer.VideoJs;
        case InlinePlaybackPlayer.Html5:
            return VideoPlayer.Html5Player;
        case InlinePlaybackPlayer.ArtPlayer:
            return VideoPlayer.ArtPlayer;
    }
}

export function toInlinePlaybackPlayer(
    player: VideoPlayer
): InlinePlaybackPlayer | null {
    switch (player) {
        case VideoPlayer.VideoJs:
            return InlinePlaybackPlayer.VideoJs;
        case VideoPlayer.Html5Player:
            return InlinePlaybackPlayer.Html5;
        case VideoPlayer.ArtPlayer:
            return InlinePlaybackPlayer.ArtPlayer;
        case VideoPlayer.EmbeddedMpv:
        case VideoPlayer.MPV:
        case VideoPlayer.VLC:
            return null;
    }
}
