import {
    PRELOAD_PERFORMANCE_MARKER_CHANNEL,
    PRELOAD_PERFORMANCE_METHOD,
    type PreloadPerformanceMarker,
} from '@iptvnator/shared/interfaces';
import { createPreloadPerformanceCapture } from './preload-performance-capture';

describe('preload performance capture timestamps', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('uses fractional monotonic time on top of the epoch origin', () => {
        const markers: PreloadPerformanceMarker[] = [];
        const monotonicNow = jest
            .spyOn(globalThis.performance, 'now')
            .mockReturnValueOnce(10.125)
            .mockReturnValueOnce(10.375);
        const capture = createPreloadPerformanceCapture(
            true,
            (channel, marker) => {
                expect(channel).toBe(PRELOAD_PERFORMANCE_MARKER_CHANNEL);
                markers.push(marker);
            }
        );

        const call = capture.start(
            PRELOAD_PERFORMANCE_METHOD.REFRESH_PLAYLIST,
            [
                {
                    operationId: 'operation-1',
                    playlistId: 'playlist-1',
                },
            ]
        );
        capture.success(call, {});

        expect(monotonicNow).toHaveBeenCalledTimes(2);
        expect(markers).toHaveLength(2);
        expect(
            markers[0].sourceEpochMs - globalThis.performance.timeOrigin
        ).toBeCloseTo(10.125, 3);
        expect(
            markers[1].sourceEpochMs - globalThis.performance.timeOrigin
        ).toBeCloseTo(10.375, 3);
        expect(markers[1].sourceEpochMs).toBeGreaterThan(
            markers[0].sourceEpochMs
        );
    });
});
