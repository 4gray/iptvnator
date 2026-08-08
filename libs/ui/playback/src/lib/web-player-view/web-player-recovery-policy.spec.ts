import {
    InlinePlaybackPlayer,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
    type PlaybackRecommendationTarget,
} from '@iptvnator/playback/util';
import type { ExternalRecoveryStates } from './external-playback-recovery';
import { createWebPlayerRecommendations } from './web-player-recovery-policy';

const DIAGNOSTIC: PlaybackDiagnostic = {
    code: PlaybackDiagnosticCode.UnsupportedContainer,
    source: PlaybackDiagnosticSource.Native,
    sourceUrl: 'https://example.com/movie.mkv',
    container: 'matroska',
    mimeType: 'video/matroska',
    player: InlinePlaybackPlayer.VideoJs,
    audioCodecs: [],
    videoCodecs: [],
};

function externalStates(
    overrides: Partial<ExternalRecoveryStates> = {}
): ExternalRecoveryStates {
    return {
        mpv: { attempts: 0, sessionId: null, status: 'idle' },
        vlc: { attempts: 0, sessionId: null, status: 'idle' },
        ...overrides,
    };
}

function recommendations(options: {
    attemptedTargets?: ReadonlySet<PlaybackRecommendationTarget>;
    diagnostic?: PlaybackDiagnostic;
    externalStates?: ExternalRecoveryStates;
}) {
    return createWebPlayerRecommendations({
        diagnostic: options.diagnostic ?? DIAGNOSTIC,
        binding: { generation: 1, target: InlinePlaybackPlayer.VideoJs },
        attemptedTargets: options.attemptedTargets ?? new Set(),
        externalStates: options.externalStates ?? externalStates(),
        managedExternalPlayersAvailable: true,
        playbackExternallyTransferable: true,
        isLive: false,
        alternativeSourceCount: 1,
    });
}

function targets(
    result: ReturnType<typeof recommendations>
): readonly string[] {
    return result.map((item) =>
        item.action === 'player' ? item.target : item.action
    );
}

describe('createWebPlayerRecommendations external outcomes', () => {
    it('keeps an attempted failed external target and promotes its untried sibling', () => {
        const result = recommendations({
            attemptedTargets: new Set(['mpv']),
            externalStates: externalStates({
                mpv: {
                    attempts: 1,
                    sessionId: 'mpv-session',
                    status: 'error',
                },
            }),
        });

        expect(targets(result)).toEqual(['vlc', 'mpv', 'alternative-source']);
        expect(result.map((item) => item.priority)).toEqual([
            'primary',
            'secondary',
            'secondary',
        ]);
    });

    it('retains inline family exclusion while reranking only external siblings', () => {
        const result = recommendations({
            diagnostic: {
                ...DIAGNOSTIC,
                code: PlaybackDiagnosticCode.MediaDecodeError,
                source: PlaybackDiagnosticSource.Hls,
                container: 'm3u8',
                mimeType: 'application/vnd.apple.mpegurl',
            },
            attemptedTargets: new Set([InlinePlaybackPlayer.Html5, 'mpv']),
            externalStates: externalStates({
                mpv: { attempts: 1, sessionId: null, status: 'error' },
            }),
        });

        expect(targets(result)).toEqual(['vlc', 'mpv', 'alternative-source']);
        expect(targets(result)).not.toContain(InlinePlaybackPlayer.Html5);
    });

    it('preserves policy order for equal attempt counts and stays capped at three', () => {
        const result = recommendations({
            attemptedTargets: new Set(['mpv', 'vlc']),
            externalStates: externalStates({
                mpv: { attempts: 2, sessionId: null, status: 'error' },
                vlc: { attempts: 2, sessionId: null, status: 'error' },
            }),
        });

        expect(targets(result)).toEqual(['mpv', 'vlc', 'alternative-source']);
        expect(result).toHaveLength(3);
    });

    it('does not mutate attempts or external state inputs', () => {
        const attemptedTargets = new Set<PlaybackRecommendationTarget>(['mpv']);
        const states = externalStates({
            mpv: { attempts: 1, sessionId: 'mpv-1', status: 'started' },
        });
        const attemptedBefore = [...attemptedTargets];
        const statesBefore = JSON.stringify(states);

        recommendations({ attemptedTargets, externalStates: states });

        expect([...attemptedTargets]).toEqual(attemptedBefore);
        expect(JSON.stringify(states)).toBe(statesBefore);
    });
});
