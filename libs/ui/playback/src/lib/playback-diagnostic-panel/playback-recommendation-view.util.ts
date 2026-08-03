import {
    type PlaybackRecommendation,
    type PlaybackRecommendationReason,
    type PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';

export function getRecommendationKey(
    recommendation: PlaybackRecommendation
): string {
    return recommendation.action === 'player'
        ? `player-${recommendation.target}`
        : recommendation.action;
}

export function getRecommendationTestId(
    recommendation: PlaybackRecommendation
): string {
    switch (recommendation.action) {
        case 'retry':
            return 'playback-retry';
        case 'alternative-source':
            return 'playback-alternative-sources';
        case 'player':
            return getPlayerTestId(recommendation.target);
    }
}

export function getRecommendationLabelKey(
    recommendation: PlaybackRecommendation
): string {
    switch (recommendation.action) {
        case 'retry':
            return 'PLAYBACK_DIAGNOSTICS.ACTION_RETRY';
        case 'alternative-source':
            return 'PORTALS.MULTI_SOURCE.TRY_ANOTHER_SOURCE';
        case 'player':
            return getPlayerLabelKey(recommendation.target);
    }
}

export function getRecommendationParams(
    recommendation: PlaybackRecommendation
): Readonly<Record<string, string>> {
    return recommendation.action === 'player'
        ? { player: getPlayerName(recommendation.target) }
        : {};
}

export function getRecommendationIcon(
    recommendation: PlaybackRecommendation
): string {
    switch (recommendation.action) {
        case 'retry':
            return 'refresh';
        case 'alternative-source':
            return 'swap_horiz';
        case 'player':
            return isExternalTarget(recommendation.target)
                ? 'open_in_new'
                : 'play_circle';
    }
}

export function getRecommendationReasonKey(
    reason: PlaybackRecommendationReason
): string {
    switch (reason) {
        case 'retry-transient-failure':
            return 'PLAYBACK_DIAGNOSTICS.REASON_RETRY_TRANSIENT_FAILURE';
        case 'retry-unknown-failure':
            return 'PLAYBACK_DIAGNOSTICS.REASON_RETRY_UNKNOWN_FAILURE';
        case 'alternative-source-available':
            return 'PLAYBACK_DIAGNOSTICS.REASON_ALTERNATIVE_SOURCE_AVAILABLE';
        case 'different-engine-family':
            return 'PLAYBACK_DIAGNOSTICS.REASON_DIFFERENT_ENGINE_FAMILY';
        case 'external-codec-or-container-support':
            return 'PLAYBACK_DIAGNOSTICS.REASON_EXTERNAL_CODEC_OR_CONTAINER_SUPPORT';
        case 'external-browser-access':
            return 'PLAYBACK_DIAGNOSTICS.REASON_EXTERNAL_BROWSER_ACCESS';
        case 'compatible-drm-path':
            return 'PLAYBACK_DIAGNOSTICS.REASON_COMPATIBLE_DRM_PATH';
    }
}

export function isTemporaryBuiltInRecommendation(
    recommendation: PlaybackRecommendation
): boolean {
    return (
        recommendation.action === 'player' &&
        !isExternalTarget(recommendation.target)
    );
}

export function isExternalPlayerRecommendation(
    recommendation: PlaybackRecommendation
): boolean {
    return (
        recommendation.action === 'player' &&
        isExternalTarget(recommendation.target)
    );
}

function getPlayerTestId(target: PlaybackRecommendationTarget): string {
    switch (target) {
        case 'videojs':
            return 'playback-recommendation-videojs';
        case 'html5':
            return 'playback-recommendation-html5';
        case 'artplayer':
            return 'playback-recommendation-artplayer';
        case 'mpv':
            return 'playback-fallback-mpv';
        case 'vlc':
            return 'playback-fallback-vlc';
    }
}

function getPlayerLabelKey(target: PlaybackRecommendationTarget): string {
    switch (target) {
        case 'videojs':
        case 'html5':
        case 'artplayer':
            return 'PLAYBACK_DIAGNOSTICS.ACTION_TRY_PLAYER';
        case 'mpv':
            return 'PLAYBACK_DIAGNOSTICS.ACTION_OPEN_MPV';
        case 'vlc':
            return 'PLAYBACK_DIAGNOSTICS.ACTION_OPEN_VLC';
    }
}

function getPlayerName(target: PlaybackRecommendationTarget): string {
    switch (target) {
        case 'videojs':
            return 'Video.js';
        case 'html5':
            return 'HTML5';
        case 'artplayer':
            return 'ArtPlayer';
        case 'mpv':
            return 'MPV';
        case 'vlc':
            return 'VLC';
    }
}

function isExternalTarget(target: PlaybackRecommendationTarget): boolean {
    return target === 'mpv' || target === 'vlc';
}
