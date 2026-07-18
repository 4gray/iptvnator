import {
    getMediaLiveEdge,
    isMediaAtLiveEdge,
    observeMediaLiveEdge,
    seekMediaToLiveEdge,
} from './live-edge';

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

    it('reports at-live-edge only while playing within the tolerance', () => {
        const seekable = createTimeRanges([[0, 100]]);
        const base = { duration: Number.POSITIVE_INFINITY, seekable };

        expect(
            isMediaAtLiveEdge({ ...base, currentTime: 90, paused: false })
        ).toBe(true);
        expect(
            isMediaAtLiveEdge({ ...base, currentTime: 40, paused: false })
        ).toBe(false);
        expect(
            isMediaAtLiveEdge({ ...base, currentTime: 99, paused: true })
        ).toBe(false);
    });

    it('treats an unknown live edge as live', () => {
        expect(
            isMediaAtLiveEdge({
                duration: Number.POSITIVE_INFINITY,
                seekable: createTimeRanges([]),
                currentTime: 5,
                paused: false,
            })
        ).toBe(true);
    });

    it('observes media events and stops after dispose', () => {
        const media = document.createElement('video');
        Object.defineProperty(media, 'seekable', {
            configurable: true,
            value: createTimeRanges([[0, 100]]),
        });
        Object.defineProperty(media, 'paused', {
            configurable: true,
            value: false,
        });
        media.currentTime = 95;

        const changes: boolean[] = [];
        const dispose = observeMediaLiveEdge(media, (atLiveEdge) =>
            changes.push(atLiveEdge)
        );
        expect(changes).toEqual([true]);

        media.currentTime = 40;
        media.dispatchEvent(new Event('timeupdate'));
        expect(changes).toEqual([true, false]);

        dispose();
        media.dispatchEvent(new Event('timeupdate'));
        expect(changes).toEqual([true, false]);
    });
});

function createTimeRanges(ranges: Array<[number, number]>): TimeRanges {
    return {
        length: ranges.length,
        start: (index: number) => ranges[index][0],
        end: (index: number) => ranges[index][1],
    } as TimeRanges;
}
