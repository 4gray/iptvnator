import { InlinePlaybackPlayer } from './diagnostics/playback-diagnostics.model';
import {
    PlaybackEngineFamily,
    type PlaybackRecommendationContext,
    type PlaybackRecommendationTarget,
    type PlaybackTargetCapability,
} from './playback-recommendation.model';
import { getInlinePlaybackEngineFamily } from './playback-target-capabilities';

interface RuntimeCapabilityRecord {
    readonly target: unknown;
    readonly kind: unknown;
    readonly available: unknown;
    readonly engineFamily?: unknown;
}

export type PlaybackCapabilityIndex = ReadonlyMap<
    PlaybackRecommendationTarget,
    PlaybackTargetCapability
>;

const CANONICAL_TARGETS: readonly PlaybackRecommendationTarget[] = [
    InlinePlaybackPlayer.VideoJs,
    InlinePlaybackPlayer.Html5,
    InlinePlaybackPlayer.ArtPlayer,
    'mpv',
    'vlc',
];

export function createPlaybackCapabilityIndex(
    context: PlaybackRecommendationContext
): PlaybackCapabilityIndex | null {
    const index = new Map<
        PlaybackRecommendationTarget,
        PlaybackTargetCapability
    >();
    for (const capability of context.targetCapabilities) {
        if (!isValidCapability(context, capability, index)) {
            return null;
        }
        index.set(capability.target, capability);
    }
    if (index.size !== CANONICAL_TARGETS.length) {
        return null;
    }
    const active = index.get(context.activeTarget);
    return active?.kind === 'inline' &&
        active.available &&
        active.engineFamily !== null
        ? index
        : null;
}

export function hasAvailableCapability(
    capabilityIndex: PlaybackCapabilityIndex | null,
    target: PlaybackRecommendationTarget
): boolean {
    return capabilityIndex?.get(target)?.available === true;
}

export function getAttemptedInlineFamilies(
    context: PlaybackRecommendationContext,
    capabilityIndex: PlaybackCapabilityIndex | null
): ReadonlySet<PlaybackEngineFamily> {
    const families = new Set<PlaybackEngineFamily>();
    if (capabilityIndex === null) {
        return families;
    }
    for (const target of context.attemptedTargets) {
        const capability = capabilityIndex.get(target);
        if (
            capability?.kind === 'inline' &&
            capability.available &&
            capability.engineFamily !== null
        ) {
            families.add(capability.engineFamily);
        }
    }
    return families;
}

export function isInlineFamilyAttempted(
    target: PlaybackRecommendationTarget,
    capabilityIndex: PlaybackCapabilityIndex | null,
    attemptedFamilies: ReadonlySet<PlaybackEngineFamily>
): boolean {
    const capability = capabilityIndex?.get(target);
    return (
        capability?.kind === 'inline' &&
        capability.engineFamily !== null &&
        attemptedFamilies.has(capability.engineFamily)
    );
}

function isValidCapability(
    context: PlaybackRecommendationContext,
    capability: unknown,
    index: PlaybackCapabilityIndex
): capability is PlaybackTargetCapability {
    if (
        !hasRequiredCapabilityFields(capability) ||
        !isKnownTarget(capability.target) ||
        index.has(capability.target) ||
        typeof capability.available !== 'boolean'
    ) {
        return false;
    }
    if (!isInlineTarget(capability.target)) {
        return capability.kind === 'external';
    }
    if (capability.kind !== 'inline' || !('engineFamily' in capability)) {
        return false;
    }
    const expectedFamily = getInlinePlaybackEngineFamily(
        context.source.kind,
        capability.target
    );
    return (
        capability.engineFamily === expectedFamily &&
        !(expectedFamily === null && capability.available)
    );
}

function hasRequiredCapabilityFields(
    value: unknown
): value is RuntimeCapabilityRecord {
    return (
        typeof value === 'object' &&
        value !== null &&
        'target' in value &&
        'kind' in value &&
        'available' in value
    );
}

function isKnownTarget(value: unknown): value is PlaybackRecommendationTarget {
    return CANONICAL_TARGETS.includes(value as PlaybackRecommendationTarget);
}

function isInlineTarget(
    value: PlaybackRecommendationTarget
): value is InlinePlaybackPlayer {
    return value !== 'mpv' && value !== 'vlc';
}
