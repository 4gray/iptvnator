import type {
    Playlist,
    PlaylistRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import type { HistoryPlaylistBridge } from '../history-events';
import { mutatePlaylistHistory } from './playlist-history';

const localOnly: HistoryPlaylistBridge = {
    active: () => false,
    mutate: jest.fn(),
} as unknown as HistoryPlaylistBridge;

function touch(
    recentlyViewed: PlaylistRecentlyViewedItem[],
    item: PlaylistRecentlyViewedItem
): Promise<PlaylistRecentlyViewedItem[]> {
    return mutatePlaylistHistory(
        { _id: 'stalker-1', recentlyViewed } as unknown as Playlist,
        { kind: 'touch', item },
        localOnly,
        async (playlist) => playlist
    ).then(
        (playlist) => playlist.recentlyViewed as PlaylistRecentlyViewedItem[]
    );
}

describe('mutatePlaylistHistory touch (Stalker)', () => {
    // Stalker numbers live channels and VOD separately: ids collide.
    it('keeps a radio station and a movie with the same id as two rows', async () => {
        const radio = {
            id: '42',
            name: 'Synthetic Radio',
            radio: true,
            favoriteContentType: 'itv',
        } as unknown as PlaylistRecentlyViewedItem;
        const movie = {
            id: '42',
            name: 'Synthetic Film',
            favoriteContentType: 'vod',
            category_id: '7',
        } as unknown as PlaylistRecentlyViewedItem;

        const rows = await touch([radio], movie);

        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual(
            expect.objectContaining({ name: 'Synthetic Film' })
        );
        // Nothing of the radio row leaks into the movie.
        expect(rows[0]).not.toHaveProperty('radio');
        expect(rows[1]).toEqual(expect.objectContaining({ radio: true }));
    });

    it('keeps a live channel and a series with the same id as two rows', async () => {
        const live = {
            id: '42',
            name: 'Synthetic Channel',
            favoriteContentType: 'itv',
        } as unknown as PlaylistRecentlyViewedItem;
        const series = {
            id: '42:42',
            name: 'Synthetic Series',
            favoriteContentType: 'series',
            series_id: '42',
        } as unknown as PlaylistRecentlyViewedItem;

        expect(await touch([live], series)).toHaveLength(2);
    });

    it('keeps regular and VOD series with the same parent id separate', async () => {
        const regular = {
            id: '42:101',
            series_id: '42',
            title: 'Synthetic Regular Series',
            favoriteContentType: 'series',
        } as const;
        const lazy = {
            id: '42:201',
            series_id: '42',
            title: 'Synthetic VOD Series',
            favoriteContentType: 'vod',
            is_series: '1',
        } as const;
        const nextEpisode = { ...regular, id: '42:102' };

        const rows = await touch(await touch([regular], lazy), nextEpisode);

        expect(rows).toEqual([
            expect.objectContaining(nextEpisode),
            expect.objectContaining(lazy),
        ]);
        expect(rows[0]).not.toHaveProperty('is_series');
    });

    it('moves the same item to the top and keeps its earlier fields', async () => {
        const first = {
            id: '42',
            name: 'Synthetic Film',
            favoriteContentType: 'vod',
            poster: 'kept.jpg',
        } as unknown as PlaylistRecentlyViewedItem;
        const again = {
            id: '42',
            name: 'Synthetic Film',
            favoriteContentType: 'vod',
        } as unknown as PlaylistRecentlyViewedItem;

        const rows = await touch([first], again);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(
            expect.objectContaining({ poster: 'kept.jpg' })
        );
    });

    it('still merges an older untyped row with the same id', async () => {
        const legacy = {
            id: '42',
            name: 'Synthetic Film',
        } as unknown as PlaylistRecentlyViewedItem;
        const typed = {
            id: '42',
            name: 'Synthetic Film',
            favoriteContentType: 'vod',
        } as unknown as PlaylistRecentlyViewedItem;

        expect(await touch([legacy], typed)).toHaveLength(1);
        expect(await touch([typed], legacy)).toHaveLength(1);
    });

    it('updates the same M3U stream by URL', async () => {
        const channel = {
            source: 'm3u',
            id: 'synthetic-channel',
            url: 'https://stream.example/channel.m3u8',
            title: 'Synthetic Channel',
            category_id: 'live',
            added_at: '2026-03-26T11:00:00.000Z',
        } as const;
        const updated = { ...channel, title: 'Renamed Channel' };

        expect(await touch([channel], updated)).toEqual([
            expect.objectContaining({ url: channel.url, title: updated.title }),
        ]);
    });
});
