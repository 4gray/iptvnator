import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { androidPlaybackResetAt } from './pwa-android-playback-resets';
import { PwaPlaybackPositions } from './pwa-playback-positions';

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

    it('accepts a newer Android capture after mirroring an older shared position', async () => {
        const playlist = 'synthetic-playlist';
        const activityPlayedAt = '2025-01-01T00:00:00.000Z';
        const nativeCheckpointAt = '2025-01-01T00:01:00.000Z';
        await positions.savePlaybackPositionsBatch(playlist, [
            position({ activityPlayedAt, positionSeconds: 30 }),
        ]);
        expect(
            Date.parse(
                (await positions.getPlaybackPosition(playlist, 100, 'vod'))
                    ?.updatedAt ?? ''
            )
        ).toBeGreaterThan(Date.parse(nativeCheckpointAt));

        await positions.savePlaybackPosition(
            playlist,
            position({ nativeCheckpointAt, positionSeconds: 90 })
        );
        expect(
            await positions.getPlaybackPosition(playlist, 100, 'vod')
        ).toMatchObject({ positionSeconds: 90, updatedAt: nativeCheckpointAt });
    });

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

    it('rejects a queued position with the old season after clearing a moved episode', async () => {
        const playlist = 'synthetic-playlist';
        const episode = position({
            contentType: 'episode',
            seriesXtreamId: 3,
            seasonNumber: 2,
        });
        Object.assign(window, { TvShell: { postMessage: jest.fn() } });
        try {
            await positions.savePlaybackPosition(playlist, episode);
            await positions.clearPlaybackPositionsBatch(playlist, [episode], {
                seriesXtreamId: 3,
                seasonNumber: 2,
            });
            await positions.savePlaybackPosition(playlist, {
                ...episode,
                seasonNumber: 1,
                nativeCheckpointAt: '2025-01-01T00:00:00.000Z',
            });
            expect(await positions.getAllPlaybackPositions(playlist)).toEqual(
                []
            );
        } finally {
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
                        seriesXtreamId: 4,
                    })
                ).toBe(0);
                if (seasonNumber !== undefined) {
                    expect(
                        androidPlaybackResetAt(localStorage, playlist, {
                            ...unwritten,
                            seasonNumber: 1,
                        })
                    ).toBe(0);
                }
            } finally {
                setItem.mockRestore();
                Reflect.deleteProperty(window, 'TvShell');
            }
        }
    );
});
