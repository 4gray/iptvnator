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
    });
});
