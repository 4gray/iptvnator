import {
    getLiveCollectionPlaylistNavigation,
    OPEN_M3U_CHANNEL_URL_STATE_KEY,
} from './live-collection-playlist-navigation';

describe('getLiveCollectionPlaylistNavigation', () => {
    it('opens an Xtream channel inside its playlist live layout', () => {
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'xtream',
                playlistId: 'pl-2',
                contentType: 'live',
                name: 'Xtream Live',
                logo: 'xtream.png',
                xtreamId: 20,
            })
        ).toEqual({
            link: ['/workspace', 'xtreams', 'pl-2', 'live'],
            state: {
                openXtreamLiveItemId: 20,
                openXtreamLivePlaylistId: 'pl-2',
                openXtreamLiveTitle: 'Xtream Live',
                openXtreamLivePoster: 'xtream.png',
            },
        });
    });

    it('opens an M3U channel inside its playlist by stream URL', () => {
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'm3u',
                playlistId: 'pl-1',
                streamUrl: ' https://example.com/m3u.m3u8 ',
            })
        ).toEqual({
            link: ['/workspace', 'playlists', 'pl-1', 'all'],
            state: {
                [OPEN_M3U_CHANNEL_URL_STATE_KEY]:
                    'https://example.com/m3u.m3u8',
            },
        });
    });

    it('opens a Stalker channel inside its portal ITV section, remembering its genre', () => {
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                contentType: 'live',
                name: 'Stalker Live',
                logo: 'stalker.png',
                stalkerId: 30,
                stalkerItem: { id: 30, tv_genre_id: 7 },
            })
        ).toEqual({
            link: ['/workspace', 'stalker', 'pl-3', 'itv'],
            state: {
                openStalkerLiveItemId: '30',
                openStalkerLivePlaylistId: 'pl-3',
                openStalkerLiveCategoryId: '7',
                openStalkerLiveTitle: 'Stalker Live',
                openStalkerLivePoster: 'stalker.png',
            },
        });
        // The stored row's genre wins; `categoryId` is the section marker
        // on app-written favorites and counts only when it is not one.
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: '30',
                categoryId: '5',
                stalkerItem: { id: 30, tv_genre_id: 7 },
            })?.state?.['openStalkerLiveCategoryId']
        ).toBe('7');
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: '30',
                categoryId: '5',
            })?.state?.['openStalkerLiveCategoryId']
        ).toBe('5');
        // A stored row without a genre still falls back to the All list;
        // the section marker alone (no stored row) yields no fallback.
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: '30',
                categoryId: 'itv',
                stalkerItem: { id: 30, tv_genre_id: ' ' },
            })?.state?.['openStalkerLiveCategoryId']
        ).toBe('*');
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: '30',
                categoryId: 'itv',
            })?.state
        ).not.toHaveProperty('openStalkerLiveCategoryId');
        // Genre ids are opaque portal strings, not necessarily numeric.
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: '30',
                categoryId: 'itv',
                stalkerItem: { id: 30, tv_genre_id: 'sports' },
            })?.state?.['openStalkerLiveCategoryId']
        ).toBe('sports');
        // List rows carry the genre already resolved by the collection tab.
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: '30',
                stalkerGenreId: '9',
            })?.state?.['openStalkerLiveCategoryId']
        ).toBe('9');
    });

    it('hides the action for a stored Stalker row whose id is synthetic', () => {
        // Collection services mint `<playlist>-<index>` for id-less rows;
        // the ITV catalog cannot match it.
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: 'pl-3-0',
                stalkerItem: { name: 'Nameless', cmd: 'x' },
            })
        ).toBeNull();
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: '30',
                stalkerItem: { stream_id: 30 },
            })?.link
        ).toEqual(['/workspace', 'stalker', 'pl-3', 'itv']);
        // The stored row's own id wins over a synthetic list id minted from
        // a blank `id` beside a valid `stream_id`.
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: '-',
                stalkerItem: { id: '', stream_id: 30 },
            })?.state?.['openStalkerLiveItemId']
        ).toBe('30');
    });

    it('hides the action for Stalker radio stations and rows without a channel id', () => {
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: 30,
                radio: 'true',
            })
        ).toBeNull();
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                contentType: 'live',
            })
        ).toBeNull();
    });

    it('never degrades to a playlist-only route', () => {
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'xtream',
                playlistId: 'pl-2',
                xtreamId: 0,
            })
        ).toBeNull();
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'xtream',
                playlistId: 'pl-2',
                xtreamId: undefined,
            })
        ).toBeNull();
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'm3u',
                playlistId: 'pl-1',
                streamUrl: '   ',
            })
        ).toBeNull();
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'm3u',
                playlistId: '',
                streamUrl: 'https://example.com/m3u.m3u8',
            })
        ).toBeNull();
    });

    it('applies only to live rows when the content type is known', () => {
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'xtream',
                playlistId: 'pl-2',
                contentType: 'movie',
                xtreamId: 20,
            })
        ).toBeNull();
    });
});
