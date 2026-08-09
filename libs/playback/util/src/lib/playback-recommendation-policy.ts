import type { ExternalPlayerName } from '@iptvnator/shared/interfaces';
import {
    InlinePlaybackPlayer,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    PlaybackRuntimeSupport,
} from './diagnostics/playback-diagnostics.model';
import {
    PlaybackEngineFamily,
    PlaybackRecommendationReason,
    PlaybackSourceKind,
    type PlaybackRecommendation,
    type PlaybackRecommendationContext,
    type PlaybackRecommendationTarget,
    type PlaybackTargetCapability,
} from './playback-recommendation.model';
import {
    createPlaybackCapabilityIndex,
    getAttemptedInlineFamilies,
    hasAvailableCapability,
    isInlineFamilyAttempted,
    type PlaybackCapabilityIndex,
} from './playback-recommendation-capabilities';

type WithoutPriority<T> = T extends unknown ? Omit<T, 'priority'> : never;

type PlaybackRecommendationCandidate = WithoutPriority<PlaybackRecommendation>;

type InlineCapability = Extract<
    PlaybackTargetCapability,
    { readonly kind: 'inline' }
>;

type AvailableInlineCapability = InlineCapability & {
    readonly available: true;
    readonly engineFamily: PlaybackEngineFamily;
};

export function recommendPlaybackRecovery(
    context: PlaybackRecommendationContext
): readonly PlaybackRecommendation[] {
    const capabilityIndex = hasPlayerRecoveryEvidence(context)
        ? createPlaybackCapabilityIndex(context)
        : null;
    const attemptedInlineFamilies = getAttemptedInlineFamilies(
        context,
        capabilityIndex
    );
    const seenTargets = new Set<PlaybackRecommendationTarget>();
    const candidates = buildCandidates(context, capabilityIndex).filter(
        isCandidate
    );
    const filtered = candidates.filter((candidate) => {
        if (candidate.action !== 'player') {
            return true;
        }
        if (
            candidate.target === context.activeTarget ||
            context.attemptedTargets.has(candidate.target) ||
            seenTargets.has(candidate.target) ||
            !hasAvailableCapability(capabilityIndex, candidate.target)
        ) {
            return false;
        }
        if (
            isInlineFamilyAttempted(
                candidate.target,
                capabilityIndex,
                attemptedInlineFamilies
            )
        ) {
            return false;
        }
        if (
            isExternalTarget(candidate.target) &&
            !canTransferExternally(context)
        ) {
            return false;
        }
        seenTargets.add(candidate.target);
        return true;
    });

    return filtered.slice(0, 3).map((candidate, index) => ({
        ...candidate,
        priority: index === 0 ? 'primary' : 'secondary',
    }));
}

function buildCandidates(
    context: PlaybackRecommendationContext,
    capabilityIndex: PlaybackCapabilityIndex | null
): readonly (PlaybackRecommendationCandidate | null)[] {
    if (hasPlayerRecoveryEvidence(context) && capabilityIndex === null) {
        return [retryUnknown(), alternative(context)];
    }

    if (isShakaBrowserUnsupported(context)) {
        return [
            externalCodecSupport('mpv'),
            externalCodecSupport('vlc'),
            alternative(context),
        ];
    }

    switch (context.diagnostic.code) {
        case PlaybackDiagnosticCode.NetworkError:
            return [retryTransient(), alternative(context)];
        case PlaybackDiagnosticCode.BrowserAccessError:
            return [
                external(
                    'mpv',
                    PlaybackRecommendationReason.ExternalBrowserAccess
                ),
                external(
                    'vlc',
                    PlaybackRecommendationReason.ExternalBrowserAccess
                ),
                alternative(context),
            ];
        case PlaybackDiagnosticCode.UnsupportedCodec:
        case PlaybackDiagnosticCode.UnsupportedContainer:
            return [
                externalCodecSupport('mpv'),
                externalCodecSupport('vlc'),
                alternative(context),
            ];
        case PlaybackDiagnosticCode.MediaDecodeError:
            return [
                distinctInline(
                    context,
                    capabilityIndex,
                    PlaybackRecommendationReason.DifferentEngineFamily
                ),
                externalCodecSupport('mpv'),
                externalCodecSupport('vlc'),
                alternative(context),
            ];
        case PlaybackDiagnosticCode.DrmOrEncryption:
            return [
                distinctInline(
                    context,
                    capabilityIndex,
                    PlaybackRecommendationReason.CompatibleDrmPath
                ),
                alternative(context),
                external('mpv', PlaybackRecommendationReason.CompatibleDrmPath),
                external('vlc', PlaybackRecommendationReason.CompatibleDrmPath),
            ];
        case PlaybackDiagnosticCode.UnknownPlaybackError:
        default:
            return [retryUnknown(), alternative(context)];
    }
}

function retryTransient(): PlaybackRecommendationCandidate {
    return {
        action: 'retry',
        reason: PlaybackRecommendationReason.RetryTransientFailure,
    };
}

function retryUnknown(): PlaybackRecommendationCandidate {
    return {
        action: 'retry',
        reason: PlaybackRecommendationReason.RetryUnknownFailure,
    };
}

function alternative(
    context: PlaybackRecommendationContext
): PlaybackRecommendationCandidate | null {
    return !Number.isSafeInteger(context.alternativeSourceCount) ||
        context.alternativeSourceCount <= 0
        ? null
        : {
              action: 'alternative-source',
              reason: PlaybackRecommendationReason.AlternativeSourceAvailable,
          };
}

function distinctInline(
    context: PlaybackRecommendationContext,
    capabilityIndex: PlaybackCapabilityIndex | null,
    reason: PlaybackRecommendationCandidate['reason']
): PlaybackRecommendationCandidate | null {
    const activeCapability = getActiveInlineCapability(
        context,
        capabilityIndex
    );
    if (activeCapability === null) {
        return null;
    }

    const canonicalTarget = getCanonicalDistinctInlineTarget(
        activeCapability.engineFamily
    );
    if (canonicalTarget === null) {
        return null;
    }
    const capability = capabilityIndex?.get(canonicalTarget);
    return capability?.kind !== 'inline' ||
        !capability.available ||
        capability.engineFamily === null ||
        capability.engineFamily === activeCapability.engineFamily
        ? null
        : { action: 'player', target: capability.target, reason };
}

function getCanonicalDistinctInlineTarget(
    activeFamily: PlaybackEngineFamily
): InlinePlaybackPlayer | null {
    if (activeFamily === PlaybackEngineFamily.Vhs) {
        return InlinePlaybackPlayer.Html5;
    }
    return activeFamily === PlaybackEngineFamily.HlsJs
        ? InlinePlaybackPlayer.VideoJs
        : null;
}

function getActiveInlineCapability(
    context: PlaybackRecommendationContext,
    capabilityIndex: PlaybackCapabilityIndex | null
): AvailableInlineCapability | null {
    const capability = capabilityIndex?.get(context.activeTarget);
    return capability?.kind === 'inline' &&
        capability.available &&
        capability.engineFamily !== null
        ? (capability as AvailableInlineCapability)
        : null;
}

function externalCodecSupport(
    target: ExternalPlayerName
): PlaybackRecommendationCandidate {
    return external(
        target,
        PlaybackRecommendationReason.ExternalCodecOrContainerSupport
    );
}

function external(
    target: ExternalPlayerName,
    reason: PlaybackRecommendationCandidate['reason']
): PlaybackRecommendationCandidate {
    return { action: 'player', target, reason };
}

function isPlayerOrientedDiagnostic(
    code: PlaybackRecommendationContext['diagnostic']['code']
): boolean {
    return (
        code === PlaybackDiagnosticCode.BrowserAccessError ||
        code === PlaybackDiagnosticCode.UnsupportedCodec ||
        code === PlaybackDiagnosticCode.UnsupportedContainer ||
        code === PlaybackDiagnosticCode.MediaDecodeError ||
        code === PlaybackDiagnosticCode.DrmOrEncryption
    );
}

function hasPlayerRecoveryEvidence(
    context: PlaybackRecommendationContext
): boolean {
    return (
        isPlayerOrientedDiagnostic(context.diagnostic.code) ||
        isShakaBrowserUnsupported(context)
    );
}

function isShakaBrowserUnsupported(
    context: PlaybackRecommendationContext
): boolean {
    return (
        context.diagnostic.code ===
            PlaybackDiagnosticCode.UnknownPlaybackError &&
        context.diagnostic.source === PlaybackDiagnosticSource.Shaka &&
        context.diagnostic.runtimeSupport ===
            PlaybackRuntimeSupport.ShakaBrowserUnsupported &&
        context.source.kind === PlaybackSourceKind.Dash
    );
}

function isExternalTarget(
    target: PlaybackRecommendationTarget
): target is ExternalPlayerName {
    return target === 'mpv' || target === 'vlc';
}

function canTransferExternally(
    context: PlaybackRecommendationContext
): boolean {
    return (
        context.source.drm !== 'untransferable' &&
        context.source.externalTransferable
    );
}

function isCandidate(
    candidate: PlaybackRecommendationCandidate | null
): candidate is PlaybackRecommendationCandidate {
    return candidate !== null;
}
