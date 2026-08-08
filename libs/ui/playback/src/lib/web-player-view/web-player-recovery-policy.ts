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
    type ExternalPlayerName,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { PlaybackBinding } from './playback-recovery-session';
import type { ExternalRecoveryStates } from './external-playback-recovery';

export function createWebPlayerRecommendations(options: {
    readonly diagnostic: PlaybackDiagnostic | null;
    readonly binding: PlaybackBinding | null;
    readonly attemptedTargets: ReadonlySet<PlaybackRecommendationTarget>;
    readonly externalStates: ExternalRecoveryStates;
    readonly managedExternalPlayersAvailable: boolean;
    readonly playbackExternallyTransferable: boolean;
    readonly isLive: boolean;
    readonly alternativeSourceCount: number;
}): readonly PlaybackRecommendation[] {
    if (!options.diagnostic || !options.binding) {
        return [];
    }
    const sourceKind = resolvePlaybackSourceKind(options.diagnostic);
    const attemptedInlineTargets = new Set(
        [...options.attemptedTargets].filter(
            (target) => target !== 'mpv' && target !== 'vlc'
        )
    );
    const recommendations = recommendPlaybackRecovery({
        diagnostic: options.diagnostic,
        activeTarget: options.binding.target,
        attemptedTargets: attemptedInlineTargets,
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
    return rerankExternalRecommendations(
        recommendations,
        options.externalStates
    );
}

function rerankExternalRecommendations(
    recommendations: readonly PlaybackRecommendation[],
    states: ExternalRecoveryStates
): readonly PlaybackRecommendation[] {
    const external = recommendations
        .map((recommendation, index) => ({ index, recommendation }))
        .filter(
            (
                item
            ): item is {
                readonly index: number;
                readonly recommendation: Extract<
                    PlaybackRecommendation,
                    { readonly action: 'player' }
                > & { readonly target: ExternalPlayerName };
            } =>
                item.recommendation.action === 'player' &&
                (item.recommendation.target === 'mpv' ||
                    item.recommendation.target === 'vlc')
        )
        .sort((left, right) => {
            const attemptDifference =
                states[left.recommendation.target].attempts -
                states[right.recommendation.target].attempts;
            return attemptDifference || left.index - right.index;
        });
    let externalIndex = 0;
    return recommendations.map((recommendation, index) => {
        const ranked =
            recommendation.action === 'player' &&
            (recommendation.target === 'mpv' || recommendation.target === 'vlc')
                ? external[externalIndex++].recommendation
                : recommendation;
        return {
            ...ranked,
            priority: index === 0 ? 'primary' : 'secondary',
        };
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
