import { buildPlaylistRecentItems } from './playlist-recently-viewed.utils';
import { resolvePortalActivityWatchKind } from './portal-activity-item.interface';
import type { PlaylistMeta } from './playlist-meta.type';

const labels = { stalker: 'Stalker', m3u: 'M3U' };

function stalkerPlaylist(recentlyViewed: unknown[]): PlaylistMeta {
    return {
        _id: 'stalker-1',
        title: 'Portal',
        count: 0,
        importDate: '2026-01-01T00:00:00.000Z',
        autoRefresh: false,
        macAddress: '00:1A:79:00:00:01',
        recentlyViewed,
    } as unknown as PlaylistMeta;
}

describe('buildPlaylistRecentItems (Stalker watch kind)', () => {
    it('keeps embedded-VOD shows routing as movies while tracking them as series', () => {
        // Real stored shape: no `is_series`, numeric VOD category, and the
        // `series[]` episode array the portal answered with.
        const [item] = buildPlaylistRecentItems(
            [
                stalkerPlaylist([
                    {
                        id: '17572',
                        title: 'Fake (10 episodes)',
                        category_id: '7',
                        series: [1, 2, 3],
                        added_at: '2026-09-19T16:13:50.000Z',
                    },
                ]),
            ],
            labels
        );

        expect(item.type).toBe('movie');
        expect(item.watch_kind).toBe('series');
        expect(resolvePortalActivityWatchKind(item)).toBe('series');
    });

    it('marks lazy Ministra is_series rows as series-tracked too', () => {
        const [item] = buildPlaylistRecentItems(
            [
                stalkerPlaylist([
                    {
                        id: '50001',
                        title: 'Flagged',
                        category_id: 'vod',
                        is_series: '1',
                        added_at: '2026-09-19T16:13:50.000Z',
                    },
                ]),
            ],
            labels
        );

        expect(item.type).toBe('series');
        expect(item.watch_kind).toBe('series');
    });

    it('leaves plain movies and live channels without a watch kind override', () => {
        const items = buildPlaylistRecentItems(
            [
                stalkerPlaylist([
                    {
                        id: '900',
                        title: 'A Movie',
                        category_id: '7',
                        series: [],
                        added_at: '2026-09-19T16:13:50.000Z',
                    },
                    {
                        id: '712',
                        title: 'Channel',
                        category_id: 'itv',
                        added_at: '2026-09-19T14:49:22.000Z',
                    },
                ]),
            ],
            labels
        );

        expect(items.map((item) => item.watch_kind)).toEqual([
            undefined,
            undefined,
        ]);
        expect(resolvePortalActivityWatchKind(items[0])).toBe('movie');
        expect(resolvePortalActivityWatchKind(items[1])).toBeNull();
    });
});
