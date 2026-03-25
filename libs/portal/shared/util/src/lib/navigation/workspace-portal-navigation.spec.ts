import {
    buildXtreamItemLink,
    getGlobalFavoriteNavigation,
    getRecentItemNavigation,
    getUnifiedCollectionNavigation,
} from './workspace-portal-navigation';

describe('workspace-portal-navigation', () => {
    it('builds canonical Xtream live links without category segments', () => {
        expect(
            buildXtreamItemLink({
                playlistId: 'xtream-1',
                type: 'live',
                categoryId: 42,
                itemId: 99,
            })
        ).toEqual(['/workspace', 'xtreams', 'xtream-1', 'live']);
    });

    it('builds Xtream detail links with category and item ids', () => {
        expect(
            buildXtreamItemLink({
                playlistId: 'xtream-1',
                type: 'movie',
                categoryId: 42,
                itemId: 99,
            })
        ).toEqual([
            '/workspace',
            'xtreams',
            'xtream-1',
            'vod',
            '42',
            '99',
        ]);
    });

    it('keeps M3U favorites on the playlist favorites route', () => {
        expect(
            getGlobalFavoriteNavigation({
                id: 'channel-1',
                title: 'Channel One',
                type: 'live',
                playlist_id: 'm3u-1',
                category_id: 'live',
                xtream_id: 'channel-1',
                source: 'm3u',
                poster_url: 'https://example.com/logo.png',
                added_at: '2026-03-01T00:00:00.000Z',
            })
        ).toEqual({
            link: ['/workspace', 'playlists', 'm3u-1', 'favorites'],
        });
    });

    it('builds recent-item state for Stalker recent entries', () => {
        expect(
            getRecentItemNavigation({
                id: 'stalker-1',
                title: 'Movie One',
                type: 'movie',
                playlist_id: 'stalker-1',
                category_id: 'vod',
                xtream_id: 'stalker-1',
                source: 'stalker',
                poster_url: 'https://example.com/poster.png',
                viewed_at: '2026-03-01T00:00:00.000Z',
            })
        ).toEqual({
            link: ['/workspace', 'stalker', 'stalker-1', 'recent'],
            state: {
                openRecentItem: expect.objectContaining({
                    category_id: 'vod',
                    id: 'stalker-1',
                    title: 'Movie One',
                }),
            },
        });
    });

    it('builds unified Xtream grid navigation from category-aware items', () => {
        expect(
            getUnifiedCollectionNavigation({
                uid: 'xtream::xtream-1::99',
                name: 'Movie One',
                contentType: 'movie',
                sourceType: 'xtream',
                playlistId: 'xtream-1',
                playlistName: 'Xtream Playlist',
                xtreamId: 99,
                categoryId: 42,
            })
        ).toEqual({
            link: ['/workspace', 'xtreams', 'xtream-1', 'vod', '42', '99'],
        });
    });
});
