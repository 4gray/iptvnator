import {
    PlaybackRecommendationReason,
    type PlaybackRecommendation,
    type PlaybackRecommendationPriority,
    type PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import {
    getRecommendationIcon,
    getRecommendationKey,
    getRecommendationLabelKey,
    getRecommendationParams,
    getRecommendationReasonKey,
    getRecommendationTestId,
    getExternalRecommendationStatusKey,
    isExternalRecommendationLaunching,
    isTemporaryBuiltInRecommendation,
} from './playback-recommendation-view.util';
import type { ExternalRecoveryTargetState } from '../web-player-view/external-playback-recovery';

function player(
    target: PlaybackRecommendationTarget,
    priority: PlaybackRecommendationPriority = 'secondary'
): PlaybackRecommendation {
    return {
        action: 'player',
        target,
        reason: PlaybackRecommendationReason.DifferentEngineFamily,
        priority,
    };
}

function retry(): PlaybackRecommendation {
    return {
        action: 'retry',
        reason: PlaybackRecommendationReason.RetryTransientFailure,
        priority: 'primary',
    };
}

function alternative(): PlaybackRecommendation {
    return {
        action: 'alternative-source',
        reason: PlaybackRecommendationReason.AlternativeSourceAvailable,
        priority: 'secondary',
    };
}

describe('playback recommendation view mappings', () => {
    it.each([
        [
            'mpv',
            { attempts: 1, sessionId: null, status: 'launching' },
            'PLAYBACK_DIAGNOSTICS.ACTION_OPENING_MPV',
            'PLAYBACK_DIAGNOSTICS.EXTERNAL_OPENING',
        ],
        [
            'vlc',
            { attempts: 1, sessionId: 'vlc-1', status: 'started' },
            'PLAYBACK_DIAGNOSTICS.ACTION_REOPEN_VLC',
            'PLAYBACK_DIAGNOSTICS.EXTERNAL_STARTED',
        ],
        [
            'mpv',
            { attempts: 1, sessionId: 'mpv-1', status: 'playing' },
            'PLAYBACK_DIAGNOSTICS.ACTION_REOPEN_MPV',
            'PLAYBACK_DIAGNOSTICS.EXTERNAL_PLAYING',
        ],
        [
            'vlc',
            { attempts: 2, sessionId: null, status: 'error' },
            'PLAYBACK_DIAGNOSTICS.ACTION_RETRY_VLC',
            'PLAYBACK_DIAGNOSTICS.EXTERNAL_FAILED',
        ],
    ] as const)(
        'maps %s %s state to exact action and status copy',
        (target, state, actionKey, statusKey) => {
            const recommendation = player(target);

            expect(
                getRecommendationLabelKey(
                    recommendation,
                    state as ExternalRecoveryTargetState
                )
            ).toBe(actionKey);
            expect(
                getExternalRecommendationStatusKey(
                    recommendation,
                    state as ExternalRecoveryTargetState
                )
            ).toBe(statusKey);
            expect(
                isExternalRecommendationLaunching(
                    recommendation,
                    state as ExternalRecoveryTargetState
                )
            ).toBe(state.status === 'launching');
        }
    );

    it('keeps an attempted closed target actionable without a stale status', () => {
        const recommendation = player('mpv');
        const state: ExternalRecoveryTargetState = {
            attempts: 1,
            sessionId: null,
            status: 'idle',
        };

        expect(getRecommendationLabelKey(recommendation, state)).toBe(
            'PLAYBACK_DIAGNOSTICS.ACTION_REOPEN_MPV'
        );
        expect(
            getExternalRecommendationStatusKey(recommendation, state)
        ).toBeNull();
    });

    it.each([
        ['videojs', 'playback-recommendation-videojs'],
        ['html5', 'playback-recommendation-html5'],
        ['artplayer', 'playback-recommendation-artplayer'],
        ['mpv', 'playback-fallback-mpv'],
        ['vlc', 'playback-fallback-vlc'],
    ] as const)('maps %s to its stable test id', (target, testId) => {
        expect(getRecommendationTestId(player(target))).toBe(testId);
    });

    it('keeps stable retry and alternative-source test ids', () => {
        expect(getRecommendationTestId(retry())).toBe('playback-retry');
        expect(getRecommendationTestId(alternative())).toBe(
            'playback-alternative-sources'
        );
    });

    it.each([
        ['videojs', 'Video.js'],
        ['html5', 'HTML5'],
        ['artplayer', 'ArtPlayer'],
    ] as const)(
        'maps built-in target %s to translated player copy',
        (target, name) => {
            const recommendation = player(target);

            expect(getRecommendationLabelKey(recommendation)).toBe(
                'PLAYBACK_DIAGNOSTICS.ACTION_TRY_PLAYER'
            );
            expect(getRecommendationParams(recommendation)).toEqual({
                player: name,
            });
            expect(getRecommendationIcon(recommendation)).toBe('play_circle');
            expect(isTemporaryBuiltInRecommendation(recommendation)).toBe(true);
        }
    );

    it.each([
        ['mpv', 'MPV', 'PLAYBACK_DIAGNOSTICS.ACTION_OPEN_MPV'],
        ['vlc', 'VLC', 'PLAYBACK_DIAGNOSTICS.ACTION_OPEN_VLC'],
    ] as const)(
        'maps external target %s without a temporary-player hint',
        (target, name, labelKey) => {
            const recommendation = player(target);

            expect(getRecommendationLabelKey(recommendation)).toBe(labelKey);
            expect(getRecommendationParams(recommendation)).toEqual({
                player: name,
            });
            expect(getRecommendationIcon(recommendation)).toBe('open_in_new');
            expect(isTemporaryBuiltInRecommendation(recommendation)).toBe(
                false
            );
        }
    );

    it('maps non-player actions exhaustively', () => {
        expect(getRecommendationLabelKey(retry())).toBe(
            'PLAYBACK_DIAGNOSTICS.ACTION_RETRY'
        );
        expect(getRecommendationParams(retry())).toEqual({});
        expect(getRecommendationIcon(retry())).toBe('refresh');
        expect(getRecommendationKey(retry())).toBe('retry');
        expect(isTemporaryBuiltInRecommendation(retry())).toBe(false);

        expect(getRecommendationLabelKey(alternative())).toBe(
            'PORTALS.MULTI_SOURCE.TRY_ANOTHER_SOURCE'
        );
        expect(getRecommendationParams(alternative())).toEqual({});
        expect(getRecommendationIcon(alternative())).toBe('swap_horiz');
        expect(getRecommendationKey(alternative())).toBe('alternative-source');
        expect(isTemporaryBuiltInRecommendation(alternative())).toBe(false);
    });

    it.each([
        [
            PlaybackRecommendationReason.RetryTransientFailure,
            'PLAYBACK_DIAGNOSTICS.REASON_RETRY_TRANSIENT_FAILURE',
        ],
        [
            PlaybackRecommendationReason.RetryUnknownFailure,
            'PLAYBACK_DIAGNOSTICS.REASON_RETRY_UNKNOWN_FAILURE',
        ],
        [
            PlaybackRecommendationReason.AlternativeSourceAvailable,
            'PLAYBACK_DIAGNOSTICS.REASON_ALTERNATIVE_SOURCE_AVAILABLE',
        ],
        [
            PlaybackRecommendationReason.DifferentEngineFamily,
            'PLAYBACK_DIAGNOSTICS.REASON_DIFFERENT_ENGINE_FAMILY',
        ],
        [
            PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
            'PLAYBACK_DIAGNOSTICS.REASON_EXTERNAL_CODEC_OR_CONTAINER_SUPPORT',
        ],
        [
            PlaybackRecommendationReason.ExternalBrowserAccess,
            'PLAYBACK_DIAGNOSTICS.REASON_EXTERNAL_BROWSER_ACCESS',
        ],
        [
            PlaybackRecommendationReason.CompatibleDrmPath,
            'PLAYBACK_DIAGNOSTICS.REASON_COMPATIBLE_DRM_PATH',
        ],
    ] as const)('maps reason %s to its translation key', (reason, key) => {
        expect(getRecommendationReasonKey(reason)).toBe(key);
    });

    it('keeps player recommendation keys stable and target-specific', () => {
        expect(getRecommendationKey(player('videojs'))).toBe('player-videojs');
        expect(getRecommendationKey(player('html5'))).toBe('player-html5');
        expect(getRecommendationKey(player('artplayer'))).toBe(
            'player-artplayer'
        );
        expect(getRecommendationKey(player('mpv'))).toBe('player-mpv');
        expect(getRecommendationKey(player('vlc'))).toBe('player-vlc');
    });
});
