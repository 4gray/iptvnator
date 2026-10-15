import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { EmbeddedMpvSessionGoneError } from './embedded-mpv-session-errors';
import {
    createEmbeddedMpvReconnectState,
    EMBEDDED_MPV_RECONNECT_MAX_ATTEMPTS,
    EMBEDDED_MPV_RECONNECT_STABLE_PLAYBACK_MS,
    EmbeddedMpvReconnectCoordinator,
    EmbeddedMpvReconnectState,
    isLiveEmbeddedMpvPlayback,
    resolveEmbeddedMpvReconnectDelayMs,
} from './embedded-mpv-reconnect';

const LIVE: ResolvedPortalPlayback = {
    streamUrl: 'http://host/live.ts',
    title: 'Live channel',
    isLive: true,
};
const VOD: ResolvedPortalPlayback = {
    streamUrl: 'http://host/movie.mkv',
    title: 'Movie',
    isLive: false,
    contentInfo: {
        playlistId: 'playlist-1',
        contentXtreamId: 7,
        contentType: 'vod',
    },
};
const SESSION = 'session-1';

describe('embedded MPV reconnect policy helpers', () => {
    it('backs off 2 s → 30 s and caps there', () => {
        expect(
            [0, 1, 2, 3, 4, 5].map(resolveEmbeddedMpvReconnectDelayMs)
        ).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    });

    it('treats an explicit flag, else missing content info, as live', () => {
        expect(isLiveEmbeddedMpvPlayback(LIVE)).toBe(true);
        expect(isLiveEmbeddedMpvPlayback(VOD)).toBe(false);
        expect(
            isLiveEmbeddedMpvPlayback({ streamUrl: 'http://h/x', title: 'x' })
        ).toBe(true);
        expect(isLiveEmbeddedMpvPlayback({ ...VOD, isLive: undefined })).toBe(
            false
        );
    });
});

describe('EmbeddedMpvReconnectCoordinator', () => {
    let reload: jest.Mock<void, [string, ResolvedPortalPlayback]>;
    let publish: jest.Mock<void, [string]>;
    let log: { log: jest.Mock; warn: jest.Mock };
    let coordinator: EmbeddedMpvReconnectCoordinator;
    let state: EmbeddedMpvReconnectState;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-09-03T10:00:00Z'));
        reload = jest.fn();
        publish = jest.fn();
        log = { log: jest.fn(), warn: jest.fn() };
        coordinator = new EmbeddedMpvReconnectCoordinator({
            reload,
            publish,
            log,
        });
        state = createEmbeddedMpvReconnectState(true);
    });

    afterEach(() => {
        coordinator.cancel(state);
        jest.useRealTimers();
    });

    /** A user load that reached `playing`. */
    const startPlaying = (playback: ResolvedPortalPlayback = LIVE) => {
        coordinator.onUserLoad(state, playback);
        expect(coordinator.observe(SESSION, state, 'loading', null)).toBeNull();
        expect(
            coordinator.observe(SESSION, state, 'playing', 'loading')
        ).toBeNull();
    };

    it('never retries a load that has not played yet', () => {
        coordinator.onUserLoad(state, LIVE);
        coordinator.observe(SESSION, state, 'loading', null);

        expect(
            coordinator.observe(SESSION, state, 'error', 'loading')
        ).toBeNull();
        jest.advanceTimersByTime(120_000);

        expect(reload).not.toHaveBeenCalled();
        expect(state.timer).toBeNull();
    });

    it('reloads the last playback after a drop and reports the attempt', () => {
        startPlaying();

        const info = coordinator.observe(SESSION, state, 'error', 'playing');

        expect(info).toEqual({
            attempt: 1,
            maxAttempts: EMBEDDED_MPV_RECONNECT_MAX_ATTEMPTS,
            nextAttemptAt: new Date(Date.now() + 2_000).toISOString(),
        });
        expect(reload).not.toHaveBeenCalled();
        // The poll sees the same error again: no second schedule.
        expect(coordinator.observe(SESSION, state, 'error', 'error')).toBe(
            info
        );

        jest.advanceTimersByTime(1_999);
        expect(reload).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(reload).toHaveBeenCalledWith(SESSION, LIVE);
        expect(publish).toHaveBeenCalledWith(SESSION);
        // Still pending while the attempt is loading.
        expect(coordinator.observe(SESSION, state, 'loading', 'error')).toEqual(
            info
        );
    });

    it('doubles the delay per failed attempt and gives up after the sixth', () => {
        startPlaying();
        const delays: number[] = [];
        let previous: 'playing' | 'loading' = 'playing';

        for (
            let attempt = 1;
            attempt <= EMBEDDED_MPV_RECONNECT_MAX_ATTEMPTS;
            attempt++
        ) {
            const before = Date.now();
            const info = coordinator.observe(SESSION, state, 'error', previous);
            expect(info?.attempt).toBe(attempt);
            delays.push(Date.parse(info?.nextAttemptAt ?? '') - before);
            jest.advanceTimersByTime(delays[delays.length - 1]);
            expect(reload).toHaveBeenCalledTimes(attempt);
            coordinator.observe(SESSION, state, 'loading', 'error');
            previous = 'loading';
        }

        expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
        expect(
            coordinator.observe(SESSION, state, 'error', 'loading')
        ).toBeNull();
        jest.advanceTimersByTime(60_000);
        expect(reload).toHaveBeenCalledTimes(
            EMBEDDED_MPV_RECONNECT_MAX_ATTEMPTS
        );
        expect(log.warn).toHaveBeenCalledWith(
            expect.stringContaining('giving up')
        );
    });

    it('spends the budget across short-lived recoveries and resets it after stable playback', () => {
        startPlaying();
        coordinator.observe(SESSION, state, 'error', 'playing');
        jest.advanceTimersByTime(2_000);
        coordinator.observe(SESSION, state, 'loading', 'error');
        coordinator.observe(SESSION, state, 'playing', 'loading');

        // Drops again after 10 s of playing: still the same outage.
        jest.advanceTimersByTime(10_000);
        coordinator.observe(SESSION, state, 'playing', 'playing');
        expect(
            coordinator.observe(SESSION, state, 'error', 'playing')?.attempt
        ).toBe(2);
        jest.advanceTimersByTime(4_000);
        coordinator.observe(SESSION, state, 'loading', 'error');
        coordinator.observe(SESSION, state, 'playing', 'loading');

        // Plays for the stable window: the next drop starts a fresh outage.
        jest.advanceTimersByTime(EMBEDDED_MPV_RECONNECT_STABLE_PLAYBACK_MS);
        coordinator.observe(SESSION, state, 'playing', 'playing');
        expect(
            coordinator.observe(SESSION, state, 'error', 'playing')?.attempt
        ).toBe(1);
    });

    it('treats EOF as a loss for live playback only', () => {
        startPlaying(LIVE);
        expect(
            coordinator.observe(SESSION, state, 'ended', 'playing')?.attempt
        ).toBe(1);
        jest.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenCalledWith(SESSION, LIVE);

        reload.mockClear();
        state = createEmbeddedMpvReconnectState(true);
        startPlaying(VOD);
        expect(
            coordinator.observe(SESSION, state, 'ended', 'playing')
        ).toBeNull();
        jest.advanceTimersByTime(60_000);
        expect(reload).not.toHaveBeenCalled();
    });

    it('treats a VOD EOF well before the end as a drop and resumes there (#1902)', () => {
        startPlaying(VOD);
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'playing',
            1_260,
            undefined,
            2_700
        );

        // The server closed the connection 21 min into a 45 min episode.
        const info = coordinator.observe(
            SESSION,
            state,
            'ended',
            'playing',
            1_261,
            undefined,
            2_700
        );

        expect(info?.attempt).toBe(1);
        // The poll keeps reading the same EOF until the attempt fires.
        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'ended',
                1_261,
                undefined,
                2_700
            )
        ).toBe(info);
        jest.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenLastCalledWith(SESSION, {
            ...VOD,
            startTime: 1_260,
        });
    });

    it('keeps a VOD EOF at the end, or with no known duration, as the end', () => {
        startPlaying(VOD);
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'playing',
            2_670,
            undefined,
            2_700
        );
        // 4 s short of a duration rounded down to whole seconds.
        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'playing',
                2_696,
                undefined,
                2_700
            )
        ).toBeNull();
        // A long film's closing seconds fall inside the 1 % margin.
        state = createEmbeddedMpvReconnectState(true);
        startPlaying(VOD);
        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'playing',
                7_150,
                undefined,
                7_200
            )
        ).toBeNull();
        // Without a duration nothing says the EOF came early.
        state = createEmbeddedMpvReconnectState(true);
        startPlaying(VOD);
        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'playing',
                600,
                undefined,
                null
            )
        ).toBeNull();
        jest.advanceTimersByTime(60_000);
        expect(reload).not.toHaveBeenCalled();
    });

    it('accepts the end when the reload cannot get past where it resumed', () => {
        startPlaying(VOD);
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'playing',
            2_400,
            undefined,
            2_700
        );
        // The duration was estimated from the bitrate; the file ends at 2 401 s.
        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'playing',
                2_401,
                undefined,
                2_700
            )?.attempt
        ).toBe(1);
        jest.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenLastCalledWith(SESSION, {
            ...VOD,
            startTime: 2_400,
        });

        coordinator.observe(SESSION, state, 'loading', 'ended');
        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'loading',
                2_401,
                undefined,
                2_700
            )
        ).toBeNull();
        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'ended',
                2_401,
                undefined,
                2_700
            )
        ).toBeNull();
        jest.advanceTimersByTime(60_000);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reconnects again when the resumed episode drops further on', () => {
        startPlaying(VOD);
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'playing',
            600,
            undefined,
            2_700
        );
        coordinator.observe(
            SESSION,
            state,
            'ended',
            'playing',
            600,
            undefined,
            2_700
        );
        jest.advanceTimersByTime(2_000);
        coordinator.observe(SESSION, state, 'loading', 'ended');
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'loading',
            601,
            undefined,
            2_700
        );
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'playing',
            900,
            undefined,
            2_700
        );

        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'playing',
                901,
                undefined,
                2_700
            )?.attempt
        ).toBe(2);
        jest.advanceTimersByTime(4_000);
        expect(reload).toHaveBeenLastCalledWith(SESSION, {
            ...VOD,
            startTime: 900,
        });
    });

    it('keeps retrying an early EOF when the addon refuses the reload', () => {
        startPlaying(VOD);
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'playing',
            1_200,
            undefined,
            2_700
        );
        coordinator.observe(
            SESSION,
            state,
            'ended',
            'playing',
            1_200,
            undefined,
            2_700
        );
        reload.mockImplementationOnce(() => {
            throw new Error('addon exploded');
        });
        jest.advanceTimersByTime(2_000);

        // The refused reload left the original EOF in the snapshot: it is
        // still the drop, not a reload that ended where it resumed.
        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'ended',
                1_200,
                undefined,
                2_700
            )?.attempt
        ).toBe(2);
        jest.advanceTimersByTime(4_000);
        expect(reload).toHaveBeenCalledTimes(2);
    });

    it('judges an EOF after a user seek on its position alone', () => {
        startPlaying(VOD);
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'playing',
            1_200,
            undefined,
            2_700
        );
        coordinator.observe(
            SESSION,
            state,
            'ended',
            'playing',
            1_200,
            undefined,
            2_700
        );
        jest.advanceTimersByTime(2_000);
        coordinator.observe(SESSION, state, 'loading', 'ended');
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'loading',
            1_201,
            undefined,
            2_700
        );

        // Back to 10 min; the connection drops again a few minutes later.
        coordinator.onUserSeek(state);
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'playing',
            600,
            undefined,
            2_700
        );
        coordinator.observe(
            SESSION,
            state,
            'playing',
            'playing',
            1_202,
            undefined,
            2_700
        );

        expect(
            coordinator.observe(
                SESSION,
                state,
                'ended',
                'playing',
                1_203,
                undefined,
                2_700
            )?.attempt
        ).toBe(2);
    });

    it('resumes a VOD reload where it dropped but keeps live at the live edge', () => {
        startPlaying(VOD);
        coordinator.observe(SESSION, state, 'playing', 'playing', 95);
        coordinator.observe(SESSION, state, 'playing', 'playing', 120);
        coordinator.observe(SESSION, state, 'error', 'playing', 0);
        jest.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenLastCalledWith(SESSION, {
            ...VOD,
            startTime: 120,
        });

        // A seek back to the very start is a valid resume point as well.
        reload.mockClear();
        state = createEmbeddedMpvReconnectState(true);
        startPlaying(VOD);
        coordinator.observe(SESSION, state, 'playing', 'playing', 120);
        coordinator.observe(SESSION, state, 'playing', 'playing', 0);
        coordinator.observe(SESSION, state, 'error', 'playing');
        jest.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenLastCalledWith(SESSION, {
            ...VOD,
            startTime: 0,
        });

        // The snapshot's placeholder zero before the first time-pos must not
        // beat the playback's own resume offset.
        reload.mockClear();
        state = createEmbeddedMpvReconnectState(true);
        startPlaying({ ...VOD, startTime: 30 });
        coordinator.observe(SESSION, state, 'playing', 'playing', 0);
        coordinator.observe(SESSION, state, 'error', 'playing');
        jest.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenLastCalledWith(SESSION, {
            ...VOD,
            startTime: 30,
        });

        reload.mockClear();
        state = createEmbeddedMpvReconnectState(true);
        startPlaying(LIVE);
        coordinator.observe(SESSION, state, 'playing', 'playing', 3_600);
        coordinator.observe(SESSION, state, 'error', 'playing', 3_600);
        jest.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenLastCalledWith(SESSION, LIVE);
        expect(reload.mock.calls[0][1]).not.toHaveProperty('startTime');
    });

    it('counts a reload that fails before the poll ever sees it loading', () => {
        startPlaying();
        coordinator.observe(SESSION, state, 'error', 'playing');
        jest.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenCalledTimes(1);

        // The engine failed the reload so fast that the poll still reads
        // `error` on both sides of the transition.
        const info = coordinator.observe(SESSION, state, 'error', 'error');

        expect(info?.attempt).toBe(2);
        jest.advanceTimersByTime(4_000);
        expect(reload).toHaveBeenCalledTimes(2);
    });

    it('cancels and disarms on an explicit pause command sent from a loss state', () => {
        startPlaying();
        expect(
            coordinator.observe(SESSION, state, 'error', 'playing')?.attempt
        ).toBe(1);

        coordinator.onUserPause(state);

        expect(state.pending).toBeNull();
        expect(state.timer).toBeNull();
        expect(
            coordinator.observe(SESSION, state, 'error', 'error')
        ).toBeNull();
        jest.advanceTimersByTime(60_000);
        expect(reload).not.toHaveBeenCalled();
    });

    it('leaves an error the engine attributes to itself alone', () => {
        startPlaying();

        expect(
            coordinator.observe(
                SESSION,
                state,
                'error',
                'playing',
                42,
                'engine'
            )
        ).toBeNull();
        jest.advanceTimersByTime(60_000);

        expect(reload).not.toHaveBeenCalled();
        expect(state.pending).toBeNull();
    });

    it('does not resume a stream the user paused when it drops', () => {
        startPlaying();
        expect(
            coordinator.observe(SESSION, state, 'paused', 'playing')
        ).toBeNull();

        expect(
            coordinator.observe(SESSION, state, 'error', 'paused')
        ).toBeNull();
        jest.advanceTimersByTime(60_000);
        expect(reload).not.toHaveBeenCalled();

        // Playing again re-arms the policy.
        coordinator.observe(SESSION, state, 'loading', 'error');
        coordinator.observe(SESSION, state, 'playing', 'loading');
        expect(
            coordinator.observe(SESSION, state, 'error', 'playing')?.attempt
        ).toBe(1);
    });

    it('drops a pending attempt when the stream recovers on its own', () => {
        startPlaying();
        coordinator.observe(SESSION, state, 'error', 'playing');

        expect(
            coordinator.observe(SESSION, state, 'playing', 'error')
        ).toBeNull();
        jest.advanceTimersByTime(60_000);

        expect(reload).not.toHaveBeenCalled();
        expect(state.pending).toBeNull();
    });

    it('is cancelled by a new user load, a pause, and an explicit cancel', () => {
        startPlaying();
        coordinator.observe(SESSION, state, 'error', 'playing');
        coordinator.onUserLoad(state, VOD);
        expect(state.pending).toBeNull();
        expect(state.hadPlayed).toBe(false);

        startPlaying();
        coordinator.observe(SESSION, state, 'error', 'playing');
        expect(
            coordinator.observe(SESSION, state, 'paused', 'error')
        ).toBeNull();
        expect(state.timer).toBeNull();

        coordinator.observe(SESSION, state, 'playing', 'paused');
        coordinator.observe(SESSION, state, 'error', 'playing');
        coordinator.cancel(state);
        jest.advanceTimersByTime(60_000);

        expect(reload).not.toHaveBeenCalled();
    });

    it('does nothing when the setting is off', () => {
        state = createEmbeddedMpvReconnectState(false);
        startPlaying();

        expect(
            coordinator.observe(SESSION, state, 'error', 'playing')
        ).toBeNull();
        jest.advanceTimersByTime(60_000);

        expect(reload).not.toHaveBeenCalled();
    });

    it('gives up at once when the engine behind the session is gone', () => {
        startPlaying();
        reload.mockImplementationOnce(() => {
            throw new EmbeddedMpvSessionGoneError(SESSION, 'helper exited');
        });
        coordinator.observe(SESSION, state, 'error', 'playing');

        jest.advanceTimersByTime(2_000);

        expect(reload).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(state.pending).toBeNull();
        expect(state.timer).toBeNull();
        expect(
            coordinator.observe(SESSION, state, 'error', 'error')
        ).toBeNull();
        expect(log.warn).toHaveBeenCalledWith(
            expect.stringContaining('engine gone'),
            expect.any(Error)
        );

        jest.advanceTimersByTime(120_000);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('continues the backoff when the addon refuses the reload outright', () => {
        startPlaying();
        reload.mockImplementationOnce(() => {
            throw new Error('addon exploded');
        });
        coordinator.observe(SESSION, state, 'error', 'playing');

        jest.advanceTimersByTime(2_000);

        expect(reload).toHaveBeenCalledTimes(1);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith(
            expect.stringContaining('could not start'),
            expect.any(Error)
        );
        expect(state.pending?.attempt).toBe(2);
        // No status transition ever arrives for a refused load.
        expect(
            coordinator.observe(SESSION, state, 'error', 'error')?.attempt
        ).toBe(2);

        jest.advanceTimersByTime(4_000);
        expect(reload).toHaveBeenCalledTimes(2);
    });
});
