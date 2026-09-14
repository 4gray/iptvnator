import { signal } from '@angular/core';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    buildWatchedVodPosition,
    resolvePortalSeriesWatchState,
    resolvePortalWatchState,
    watchStateFromProgressPercent,
} from './portal-watch-state';
import {
    VodWatchedToggleFeedback,
    createVodWatchedToggle,
} from './vod-watched-toggle';

const PLAYLIST = 'playlist-1';

function row(
    positionSeconds: number,
    durationSeconds = 5400
): PlaybackPositionData {
    return {
        playlistId: PLAYLIST,
        contentXtreamId: 42,
        contentType: 'vod',
        positionSeconds,
        durationSeconds,
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

describe('portal watch state', () => {
    it('maps progress onto the three catalog states at the 90% threshold', () => {
        expect(watchStateFromProgressPercent(0)).toBe('unwatched');
        expect(watchStateFromProgressPercent(1)).toBe('in-progress');
        expect(watchStateFromProgressPercent(89)).toBe('in-progress');
        expect(watchStateFromProgressPercent(90)).toBe('watched');
        expect(watchStateFromProgressPercent(100)).toBe('watched');
    });

    it('resolves a position row the same way the Resume rule does', () => {
        expect(resolvePortalWatchState(null)).toBe('unwatched');
        expect(resolvePortalWatchState(row(0))).toBe('unwatched');
        expect(resolvePortalWatchState(row(600))).toBe('in-progress');
        expect(resolvePortalWatchState(row(5000))).toBe('watched');
        // No duration means no percent — never "watched" by accident.
        expect(resolvePortalWatchState(row(5000, 0))).toBe('unwatched');
    });

    it('never reports a series as fully watched from the catalog list', () => {
        expect(resolvePortalSeriesWatchState(true)).toBe('in-progress');
        expect(resolvePortalSeriesWatchState(false)).toBe('unwatched');
    });

    it('builds a full-progress row preferring the stored duration', () => {
        const stored = buildWatchedVodPosition({
            playlistId: PLAYLIST,
            contentXtreamId: 42,
            durationSeconds: 7200,
            currentPosition: row(600, 5400),
        });
        expect(stored).toMatchObject({
            playlistId: PLAYLIST,
            contentXtreamId: 42,
            contentType: 'vod',
            positionSeconds: 5400,
            durationSeconds: 5400,
        });

        const fromMetadata = buildWatchedVodPosition({
            playlistId: PLAYLIST,
            contentXtreamId: 42,
            durationSeconds: 7200,
            currentPosition: null,
        });
        expect(fromMetadata.positionSeconds).toBe(7200);
        expect(fromMetadata.durationSeconds).toBe(7200);

        const unknown = buildWatchedVodPosition({
            playlistId: PLAYLIST,
            contentXtreamId: 42,
            durationSeconds: 0,
            currentPosition: row(600, 0),
        });
        expect(unknown.positionSeconds).toBe(1);
        expect(unknown.durationSeconds).toBe(1);
        expect(resolvePortalWatchState(unknown)).toBe('watched');
    });
});

describe('createVodWatchedToggle', () => {
    function setup(initial: PlaybackPositionData | null) {
        const position = signal<PlaybackPositionData | null>(initial);
        const playingNow = signal(false);
        const feedback: VodWatchedToggleFeedback[] = [];
        const persisted: string[] = [];
        const playbackPositions = {
            savePlaybackPositionOrThrow: jest.fn().mockResolvedValue(undefined),
            clearPlaybackPositionOrThrow: jest
                .fn()
                .mockResolvedValue(undefined),
        };
        const logger = { error: jest.fn() };
        const toggle = createVodWatchedToggle({
            playbackPositions,
            position,
            applyPosition: (next) => position.set(next),
            playingNow,
            notify: (kind) => feedback.push(kind),
            onPersisted: (playlistId) => persisted.push(playlistId),
            logger,
        });
        const target = (stillCurrent = () => true) => ({
            playlistId: PLAYLIST,
            contentXtreamId: 42,
            durationSeconds: 5400,
            stillCurrent,
        });
        return {
            toggle,
            position,
            playingNow,
            feedback,
            persisted,
            playbackPositions,
            logger,
            target,
        };
    }

    it('marks an unwatched movie by writing a full-progress row', async () => {
        const t = setup(null);
        expect(t.toggle.isWatched()).toBe(false);

        await expect(t.toggle.toggle(t.target())).resolves.toBe(true);

        expect(
            t.playbackPositions.savePlaybackPositionOrThrow
        ).toHaveBeenCalledWith(
            PLAYLIST,
            expect.objectContaining({
                contentXtreamId: 42,
                contentType: 'vod',
                positionSeconds: 5400,
                durationSeconds: 5400,
            })
        );
        expect(t.toggle.isWatched()).toBe(true);
        expect(t.feedback).toEqual(['marked']);
        expect(t.persisted).toEqual([PLAYLIST]);
    });

    it('unmarks a watched movie by clearing its row', async () => {
        const t = setup(row(5400));
        expect(t.toggle.isWatched()).toBe(true);

        await expect(t.toggle.toggle(t.target())).resolves.toBe(true);

        expect(
            t.playbackPositions.clearPlaybackPositionOrThrow
        ).toHaveBeenCalledWith(PLAYLIST, 42, 'vod');
        expect(t.position()).toBeNull();
        expect(t.toggle.isWatched()).toBe(false);
        expect(t.feedback).toEqual(['unmarked']);
    });

    it('keeps the rendered row and reports when the write is refused', async () => {
        const t = setup(row(600));
        t.playbackPositions.savePlaybackPositionOrThrow.mockRejectedValue(
            new Error('disk full')
        );

        await expect(t.toggle.toggle(t.target())).resolves.toBe(false);

        expect(t.position()).toEqual(row(600));
        expect(t.feedback).toEqual(['failed']);
        expect(t.persisted).toEqual([]);
        expect(t.logger.error).toHaveBeenCalled();
        expect(t.toggle.busy()).toBe(false);
    });

    it('logs a failed post-write refresh without failing the toggle', async () => {
        const position = signal<PlaybackPositionData | null>(null);
        const logger = { error: jest.fn() };
        const toggle = createVodWatchedToggle({
            playbackPositions: {
                savePlaybackPositionOrThrow: jest
                    .fn()
                    .mockResolvedValue(undefined),
                clearPlaybackPositionOrThrow: jest
                    .fn()
                    .mockResolvedValue(undefined),
            },
            position,
            applyPosition: (next) => position.set(next),
            notify: jest.fn(),
            onPersisted: () => Promise.reject(new Error('ipc down')),
            logger,
        });

        await expect(
            toggle.toggle({
                playlistId: PLAYLIST,
                contentXtreamId: 42,
                stillCurrent: () => true,
            })
        ).resolves.toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(toggle.isWatched()).toBe(true);
        expect(logger.error).toHaveBeenCalledWith(
            'Refresh after watched toggle failed',
            expect.any(Error)
        );
    });

    it('stays disabled while playback could overwrite the row', async () => {
        const t = setup(null);
        t.playingNow.set(true);

        expect(t.toggle.enabled()).toBe(false);
        await expect(t.toggle.toggle(t.target())).resolves.toBe(false);
        expect(
            t.playbackPositions.savePlaybackPositionOrThrow
        ).not.toHaveBeenCalled();
    });

    it('serializes overlapping toggles', async () => {
        const t = setup(null);
        let release!: () => void;
        t.playbackPositions.savePlaybackPositionOrThrow.mockReturnValue(
            new Promise<void>((resolve) => {
                release = resolve;
            })
        );

        const first = t.toggle.toggle(t.target());
        expect(t.toggle.busy()).toBe(true);
        expect(t.toggle.enabled()).toBe(false);
        await expect(t.toggle.toggle(t.target())).resolves.toBe(false);

        release();
        await expect(first).resolves.toBe(true);
        expect(
            t.playbackPositions.savePlaybackPositionOrThrow
        ).toHaveBeenCalledTimes(1);
    });

    it('does not patch the page or announce after the movie changed', async () => {
        const t = setup(null);

        await expect(t.toggle.toggle(t.target(() => false))).resolves.toBe(
            true
        );

        expect(
            t.playbackPositions.savePlaybackPositionOrThrow
        ).toHaveBeenCalledTimes(1);
        expect(t.position()).toBeNull();
        expect(t.feedback).toEqual([]);
        // The row did land for that playlist, so its badges still refresh.
        expect(t.persisted).toEqual([PLAYLIST]);
    });
});
