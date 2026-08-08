import {
    InlinePlaybackPlayer,
    createPlaybackTargetCapabilities,
    recommendPlaybackRecovery,
    resolvePlaybackSourceKind,
    type PlaybackDiagnostic,
    type PlaybackRecommendation,
    type PlaybackRecommendationContext,
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
    const context: PlaybackRecommendationContext = {
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
    };
    const recommendations = revealCappedExternalSiblings(
        recommendPlaybackRecovery(context),
        context,
        options.externalStates
    );
    return rerankExternalRecommendations(
        recommendations,
        options.externalStates
    );
}

function revealCappedExternalSiblings(
    recommendations: readonly PlaybackRecommendation[],
    context: PlaybackRecommendationContext,
    states: ExternalRecoveryStates
): readonly PlaybackRecommendation[] {
    const externalTargets: readonly ExternalPlayerName[] = ['mpv', 'vlc'];
    if (!externalTargets.some((target) => states[target].attempts > 0)) {
        return recommendations;
    }
    const retained = [...recommendations];
    for (const target of externalTargets) {
        if (
            retained.some(
                (recommendation) =>
                    isExternalRecommendation(recommendation) &&
                    recommendation.target === target
            )
        ) {
            continue;
        }
        const siblingTarget: ExternalPlayerName =
            target === 'mpv' ? 'vlc' : 'mpv';
        const candidate = recommendPlaybackRecovery({
            ...context,
            attemptedTargets: new Set([
                ...context.attemptedTargets,
                siblingTarget,
            ]),
        }).find(
            (recommendation) =>
                isExternalRecommendation(recommendation) &&
                recommendation.target === target
        );
        if (!candidate) {
            continue;
        }
        if (retained.length >= 3) {
            const replaceIndex = retained.findLastIndex(
                (recommendation, index) =>
                    index > 0 && !isExternalRecommendation(recommendation)
            );
            if (replaceIndex < 0) {
                continue;
            }
            retained.splice(replaceIndex, 1);
        }
        retained.push(candidate);
    }
    return retained;
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

function isExternalRecommendation(
    recommendation: PlaybackRecommendation
): recommendation is Extract<PlaybackRecommendation, { readonly action: 'player' }> & {
    readonly target: ExternalPlayerName;
} {
    return (
        recommendation.action === 'player' &&
        (recommendation.target === 'mpv' || recommendation.target === 'vlc')
    );
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
