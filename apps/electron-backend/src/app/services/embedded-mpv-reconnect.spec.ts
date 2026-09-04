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
