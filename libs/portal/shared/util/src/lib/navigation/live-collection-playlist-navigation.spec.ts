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

    it('hides the action for Stalker rows until their ITV layout can open a channel', () => {
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
