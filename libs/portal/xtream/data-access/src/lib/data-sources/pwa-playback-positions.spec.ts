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

    it.each([undefined, 2])(
        'clears a series or season at quota with a single marker (%s)',
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
