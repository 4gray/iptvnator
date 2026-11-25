import { signal } from '@angular/core';
import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import {
    EmbeddedMpvLiveEdge,
    LIVE_EDGE_SETTLE_MS,
    isLiveEdgeContainer,
    liveEdgeJumpSeconds,
} from './embedded-mpv-live-edge';

function liveSession(
    overrides: Partial<EmbeddedMpvSession> = {}
): EmbeddedMpvSession {
    return {
        id: 'session-1',
        title: 'Live news',
        streamUrl: 'https://example.com/live/1.ts',
        status: 'playing',
        positionSeconds: 120,
        durationSeconds: null,
        volume: 1,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        recording: { active: false },
        startedAt: '2026-07-16T10:00:00.000Z',
        updatedAt: '2026-07-16T10:00:01.000Z',
        stats: { container: 'mpegts', bufferedAheadSeconds: 23 },
        ...overrides,
    };
}

describe('isLiveEdgeContainer', () => {
    it('accepts MPEG-TS only', () => {
        expect(isLiveEdgeContainer(liveSession())).toBe(true);
        expect(
            isLiveEdgeContainer(liveSession({ stats: { container: 'hls' } }))
        ).toBe(false);
        expect(isLiveEdgeContainer(liveSession({ stats: undefined }))).toBe(
            false
        );
        expect(isLiveEdgeContainer(null)).toBe(false);
    });
});

describe('liveEdgeJumpSeconds', () => {
    it('skips the backlog down to a 3 s buffer', () => {
        expect(liveEdgeJumpSeconds(liveSession())).toBe(20);
    });

    it('works while paused, since the cache keeps filling', () => {
        expect(liveEdgeJumpSeconds(liveSession({ status: 'paused' }))).toBe(20);
    });

    it('does nothing at or below the 3 s target', () => {
        const withBuffer = (bufferedAheadSeconds: number) =>
            liveSession({
                stats: { container: 'mpegts', bufferedAheadSeconds },
            });
        expect(liveEdgeJumpSeconds(withBuffer(3))).toBeNull();
        expect(liveEdgeJumpSeconds(withBuffer(2.2))).toBeNull();
        expect(liveEdgeJumpSeconds(withBuffer(3.25))).toBe(0.25);
    });

    it('never jumps HLS, whose cache ends at the newest complete segment', () => {
        expect(
            liveEdgeJumpSeconds(
                liveSession({
                    stats: { container: 'hls', bufferedAheadSeconds: 28 },
                })
            )
        ).toBeNull();
    });

    it('needs a playing or paused session with a known buffer', () => {
        expect(liveEdgeJumpSeconds(null)).toBeNull();
        expect(
            liveEdgeJumpSeconds(liveSession({ status: 'loading' }))
        ).toBeNull();
        expect(
            liveEdgeJumpSeconds(liveSession({ status: 'error' }))
        ).toBeNull();
        expect(
            liveEdgeJumpSeconds(
                liveSession({
                    reconnect: {
                        attempt: 1,
                        maxAttempts: 3,
                        nextAttemptAt: '2026-07-16T10:00:05.000Z',
                    },
                })
            )
        ).toBeNull();
        expect(
            liveEdgeJumpSeconds(liveSession({ stats: { container: 'mpegts' } }))
        ).toBeNull();
        expect(
            liveEdgeJumpSeconds(
                liveSession({
                    stats: {
                        container: 'mpegts',
                        bufferedAheadSeconds: Number.NaN,
                    },
                })
            )
        ).toBeNull();
    });
});

describe('EmbeddedMpvLiveEdge', () => {
    it('seeks by the computed delta and ignores repeats until settled', () => {
        let now = 1_000;
        const session = signal<EmbeddedMpvSession | null>(liveSession());
        const seekBy = jest.fn().mockResolvedValue(true);
        const liveEdge = new EmbeddedMpvLiveEdge(session, seekBy, () => now);

        expect(liveEdge.jump()).toBe(true);
        expect(seekBy).toHaveBeenCalledWith(20);

        // The reply snapshot may still carry the pre-seek buffer.
        now += LIVE_EDGE_SETTLE_MS - 1;
        expect(liveEdge.jump()).toBe(false);
        expect(seekBy).toHaveBeenCalledTimes(1);

        now += 1;
        session.set(
            liveSession({
                stats: { container: 'mpegts', bufferedAheadSeconds: 9 },
            })
        );
        expect(liveEdge.jump()).toBe(true);
        expect(seekBy).toHaveBeenLastCalledWith(6);
    });

    it('sends nothing and does not arm the debounce when it cannot jump', () => {
        const session = signal<EmbeddedMpvSession | null>(
            liveSession({ stats: { container: 'hls' } })
        );
        const seekBy = jest.fn().mockResolvedValue(true);
        const liveEdge = new EmbeddedMpvLiveEdge(session, seekBy, () => 1_000);

        expect(liveEdge.supported()).toBe(false);
        expect(liveEdge.jump()).toBe(false);

        session.set(liveSession());
        expect(liveEdge.supported()).toBe(true);
        expect(liveEdge.jump()).toBe(true);
        expect(seekBy).toHaveBeenCalledTimes(1);
    });
});
