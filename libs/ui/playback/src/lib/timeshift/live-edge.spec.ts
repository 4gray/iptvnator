import { getMediaLiveEdge, seekMediaToLiveEdge } from './live-edge';

describe('live edge helpers', () => {
    it('uses the end of the latest seekable range', () => {
        const media = {
            duration: Number.POSITIVE_INFINITY,
            seekable: createTimeRanges([
                [0, 30],
                [40, 95],
            ]),
        };

        expect(getMediaLiveEdge(media)).toBe(95);
    });

    it('falls back to a finite media duration', () => {
        expect(
            getMediaLiveEdge({
                duration: 120,
                seekable: createTimeRanges([]),
            })
        ).toBe(120);
    });

    it('seeks just behind the live edge and resumes playback', () => {
        const media = document.createElement('video');
        Object.defineProperty(media, 'seekable', {
            configurable: true,
            value: createTimeRanges([[10, 72]]),
        });
        const play = jest.spyOn(media, 'play').mockResolvedValue(undefined);

        expect(seekMediaToLiveEdge(media)).toBe(true);
        expect(media.currentTime).toBe(71.75);
        expect(play).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no finite live edge is available', () => {
        const media = document.createElement('video');
        Object.defineProperty(media, 'duration', {
            configurable: true,
            value: Number.POSITIVE_INFINITY,
        });
        const play = jest.spyOn(media, 'play').mockResolvedValue(undefined);

        expect(seekMediaToLiveEdge(media)).toBe(false);
        expect(play).not.toHaveBeenCalled();
    });
});

function createTimeRanges(ranges: Array<[number, number]>): TimeRanges {
    return {
        length: ranges.length,
        start: (index: number) => ranges[index][0],
        end: (index: number) => ranges[index][1],
    } as TimeRanges;
}
