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
                stalkerItem: { tv_genre_id: 7 },
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
        // An explicit category wins over the stored row's genre.
        expect(
            getLiveCollectionPlaylistNavigation({
                sourceType: 'stalker',
                playlistId: 'pl-3',
                stalkerId: '30',
                categoryId: '5',
                stalkerItem: { tv_genre_id: 7 },
            })?.state?.['openStalkerLiveCategoryId']
        ).toBe('5');
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
