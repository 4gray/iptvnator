import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { filterXtreamVodByWatchState } from './xtream-vod-watch-filter';

const row = (
    id: number,
    seconds: number,
    duration?: number
): PlaybackPositionData => ({
    playlistId: 'a',
    contentType: 'vod',
    contentXtreamId: id,
    positionSeconds: seconds,
    durationSeconds: duration,
});

describe('filterXtreamVodByWatchState', () => {
    const items = [
        { xtream_id: 1, id: 50 },
        { stream_id: '2' },
        { xtream_id: 3 },
        { xtream_id: 4 },
        { id: 1 },
    ];
    const positions = new Map([
        ['vod_1', row(1, 89.5, 100)],
        ['vod_2', row(2, 89.49, 100)],
        ['vod_3', row(3, 50)],
        ['episode_4', { ...row(4, 100, 100), contentType: 'episode' as const }],
    ]);
    it('returns the original array for All', () => {
        expect(filterXtreamVodByWatchState(items, null, positions)).toBe(items);
    });
    it('uses rounded classifier, provider ID and movie-only identity', () => {
        expect(
            filterXtreamVodByWatchState(items, 'watched', positions)
        ).toEqual([items[0]]);
        expect(
            filterXtreamVodByWatchState(items, 'in-progress', positions)
        ).toEqual([items[1]]);
        expect(
            filterXtreamVodByWatchState(items, 'unwatched', positions)
        ).toEqual([items[2], items[3]]);
    });
    it('honors manual marks and excludes invalid provider IDs only under a filter', () => {
        expect(
            filterXtreamVodByWatchState(
                [{ xtream_id: 1 }, { xtream_id: 0 }, { xtream_id: 'bad' }],
                'watched',
                new Map([['vod_1', row(1, 1, 1)]])
            )
        ).toEqual([{ xtream_id: 1 }]);
    });
});
