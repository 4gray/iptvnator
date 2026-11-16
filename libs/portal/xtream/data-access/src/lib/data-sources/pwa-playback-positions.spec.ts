import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { androidPlaybackResetAt } from './pwa-android-playback-resets';
import { PwaPlaybackPositions } from './pwa-playback-positions';
import { clearPlaylistPlaybackPositions } from './pwa-playback-position-storage';

describe('Android playback position resets', () => {
    const storageKey = 'xtream-playback-positions';
    const positions = new PwaPlaybackPositions(localStorage);
    const position = (
        overrides: Partial<PlaybackPositionData> = {}
    ): PlaybackPositionData => ({
        contentXtreamId: 100,
        contentType: 'vod',
        positionSeconds: 42,
        durationSeconds: 5400,
        ...overrides,
    });

    beforeEach(() => localStorage.clear());

    it('keeps later episodes ahead of a checkpoint saved on retry', async () => {
        const older = '2025-01-01T00:00:00.000Z';
        await positions.savePlaybackPosition(
            'synthetic-playlist',
            position({
                contentType: 'episode',
                contentXtreamId: 102,
            })
        );
        await positions.savePlaybackPosition(
            'synthetic-playlist',
            position({
                contentType: 'episode',
                contentXtreamId: 101,
                nativeCheckpointAt: older,
            })
        );
        const recent =
            await positions.getRecentPlaybackPositions('synthetic-playlist');
        expect(recent.map((episode) => episode.contentXtreamId)).toEqual([
            102, 101,
        ]);
        expect(recent[1].updatedAt).toBe(older);
    });

    it.each([false, true])(
        'compares mirrored progress with server time (batch: %s)',
        async (batch) => {
            const playlist = 'synthetic-playlist';
            const updatedAt = '2025-01-01T00:00:00.000Z';
            const nativeCheckpointAt = '2025-01-01T00:01:00.000Z';
            const activityPlayedAt = '2025-01-01T00:02:00.000Z';
            const mirrored = position({
                activityPlayedAt,
                updatedAt,
                positionSeconds: 30,
            });
            if (batch)
                await positions.savePlaybackPositionsBatch(playlist, [
                    mirrored,
                ]);
            else await positions.savePlaybackPosition(playlist, mirrored);
            expect(
                await positions.getPlaybackPosition(playlist, 100, 'vod')
            ).toMatchObject({ positionSeconds: 30, updatedAt });

            await positions.savePlaybackPosition(
                playlist,
                position({ nativeCheckpointAt, positionSeconds: 90 })
            );
            expect(
                await positions.getPlaybackPosition(playlist, 100, 'vod')
            ).toMatchObject({
                positionSeconds: 90,
                updatedAt: nativeCheckpointAt,
            });
        }
    );

    it('rejects a delayed save against the current position or a completed reset', async () => {
        const playlist = 'synthetic-playlist';
        const row = position({
            nativeCheckpointAt: '2025-01-01T00:00:00.000Z',
        });
        Object.assign(window, { TvShell: { postMessage: jest.fn() } });
        try {
            await positions.savePlaybackPosition(playlist, {
                ...row,
                nativeCheckpointAt: undefined,
                positionSeconds: 99,
            });
            await positions.savePlaybackPosition(playlist, row);
            expect(
                (await positions.getPlaybackPosition(playlist, 100, 'vod'))
                    ?.positionSeconds
            ).toBe(99);
            await positions.clearPlaybackPosition(playlist, 100, 'vod');
            await positions.savePlaybackPosition(playlist, row);
            expect(
                await positions.getPlaybackPosition(playlist, 100, 'vod')
            ).toBeNull();
        } finally {
            Reflect.deleteProperty(window, 'TvShell');
        }
    });

    it.each([true, false])(
        'matches resets to episode IDs after a season changes (stored position: %s)',
        async (stored) => {
            const playlist = 'synthetic-playlist';
            const episode = position({
                contentType: 'episode',
                seriesXtreamId: 3,
                seasonNumber: 2,
            });
            Object.assign(window, { TvShell: { postMessage: jest.fn() } });
            try {
                if (stored)
                    await positions.savePlaybackPosition(playlist, episode);
                const secondTarget = { ...episode, contentXtreamId: 102 };
                await positions.clearPlaybackPositionsBatch(
                    playlist,
                    [episode, secondTarget],
                    {
                        seriesXtreamId: 3,
                        seasonNumber: 2,
                    }
                );
                const nativeCheckpointAt = '2025-01-01T00:00:00.000Z';
                for (const target of [episode, secondTarget])
                    await positions.savePlaybackPosition(playlist, {
                        ...target,
                        seasonNumber: 1,
                        nativeCheckpointAt,
                    });
                const movedOut = { ...episode, contentXtreamId: 101 };
                await positions.savePlaybackPosition(playlist, {
                    ...movedOut,
                    nativeCheckpointAt,
                });
                expect(
                    await positions.getAllPlaybackPositions(playlist)
                ).toEqual([{ ...movedOut, updatedAt: nativeCheckpointAt }]);
            } finally {
                Reflect.deleteProperty(window, 'TvShell');
            }
        }
    );

    it('keeps only the playlist-wide barrier when deleting its positions', async () => {
        const playlist = 'synthetic-playlist';
        const other = 'synthetic-playlist-other';
        const episode = position({
            contentType: 'episode',
            seriesXtreamId: 3,
            seasonNumber: 2,
        });
        const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
        Object.assign(window, { TvShell: { postMessage: jest.fn() } });
        try {
            for (const source of [playlist, other]) {
                await positions.clearPlaybackPosition(
                    source,
                    episode.contentXtreamId,
                    'episode'
                );
                await positions.clearPlaybackPositionsBatch(source, [episode], {
                    seriesXtreamId: 3,
                    seasonNumber: 2,
                });
            }
            now.mockReturnValue(2000);
            clearPlaylistPlaybackPositions(localStorage, playlist);
            const stored = JSON.parse(localStorage.getItem(storageKey)!);
            expect(stored.__iptvnator_native_playback_resets__).toEqual({
                [playlist]: 2000,
                [JSON.stringify([other, 'episode', episode.contentXtreamId])]:
                    1000,
            });
            expect(
                Object.keys(stored.__iptvnator_native_playback_episode_resets__)
            ).toEqual([other]);
            expect(
                androidPlaybackResetAt(localStorage, playlist, episode)
            ).toBe(2000);
            expect(androidPlaybackResetAt(localStorage, other, episode)).toBe(
                1000
            );
        } finally {
            now.mockRestore();
            Reflect.deleteProperty(window, 'TvShell');
        }
    });

    it.each([undefined, 2])(
        'clears a series or season at quota (%s)',
        async (seasonNumber) => {
            const playlist = 'synthetic-playlist';
            Object.assign(window, { TvShell: { postMessage: jest.fn() } });
            const setItem = jest.spyOn(Storage.prototype, 'setItem');
            const originalSetItem = setItem.getMockImplementation()!;
            try {
                await positions.savePlaybackPosition(
                    playlist,
                    position({
                        contentType: 'episode',
                        seriesXtreamId: 3,
                        seasonNumber: 2,
                    })
                );
                const quota = localStorage.getItem(storageKey)!.length;
                setItem.mockClear().mockImplementation(function (
                    this: Storage,
                    key,
                    value
                ) {
                    if (key !== storageKey || value.length > quota)
                        throw new DOMException(
                            'Synthetic quota',
                            'QuotaExceededError'
                        );
                    originalSetItem.call(this, key, value);
                });
                await positions.clearPlaybackPositionsBatch(
                    playlist,
                    Array.from({ length: 60 }, (_, index) => ({
                        contentType: 'episode',
                        contentXtreamId: 100 + index,
                    })),
                    { seriesXtreamId: 3, seasonNumber }
                );
                expect(setItem).toHaveBeenCalledTimes(1);
                expect(
                    await positions.getAllPlaybackPositions(playlist)
                ).toEqual([]);
                const unwritten = position({
                    contentType: 'episode',
                    contentXtreamId: 159,
                    seriesXtreamId: 3,
                    seasonNumber: 2,
                });
                expect(
                    androidPlaybackResetAt(localStorage, playlist, unwritten)
                ).toBeGreaterThan(0);
                expect(
                    androidPlaybackResetAt(localStorage, playlist, {
                        ...unwritten,
                        contentXtreamId: 160,
                    })
                ).toBe(0);
                if (seasonNumber !== undefined) {
                    expect(
                        androidPlaybackResetAt(localStorage, playlist, {
                            ...unwritten,
                            seasonNumber: 1,
                        })
                    ).toBeGreaterThan(0);
                }
            } finally {
                setItem.mockRestore();
                Reflect.deleteProperty(window, 'TvShell');
            }
        }
    );
});
