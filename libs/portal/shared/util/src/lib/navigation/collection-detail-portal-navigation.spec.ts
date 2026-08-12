import { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';
import { getUnifiedCollectionDetailNavigation } from './collection-detail-portal-navigation';

describe('getUnifiedCollectionDetailNavigation', () => {
    const xtreamMovie: UnifiedCollectionItem = {
        uid: 'xtream::xtream-1::movie:99',
        name: 'Movie One',
        contentType: 'movie',
        sourceType: 'xtream',
        playlistId: 'xtream-1',
        playlistName: 'Xtream Playlist',
        xtreamId: 99,
        categoryId: 42,
    };

    it('builds the full Xtream detail route for a movie', () => {
        expect(getUnifiedCollectionDetailNavigation(xtreamMovie)).toEqual({
            link: ['/workspace', 'xtreams', 'xtream-1', 'vod', '42', '99'],
        });
    });

    it('builds the full Xtream detail route for a series', () => {
        expect(
            getUnifiedCollectionDetailNavigation({
                ...xtreamMovie,
                uid: 'xtream::xtream-1::series:103',
                contentType: 'series',
                xtreamId: 103,
                categoryId: 7,
            })
        ).toEqual({
            link: ['/workspace', 'xtreams', 'xtream-1', 'series', '7', '103'],
        });
    });

    it('returns null instead of a degraded link when the category is missing', () => {
        expect(
            getUnifiedCollectionDetailNavigation({
                ...xtreamMovie,
                categoryId: undefined,
            })
        ).toBeNull();
        expect(
            getUnifiedCollectionDetailNavigation({
                ...xtreamMovie,
                categoryId: '   ',
            })
        ).toBeNull();
    });

    it('returns null when no positive Xtream item id is resolvable', () => {
        expect(
            getUnifiedCollectionDetailNavigation({
                ...xtreamMovie,
                uid: 'xtream::xtream-1::movie:abc',
                xtreamId: undefined,
            })
        ).toBeNull();
        expect(
            getUnifiedCollectionDetailNavigation({
                ...xtreamMovie,
                xtreamId: -5,
                uid: 'xtream::xtream-1::movie:-5',
            })
        ).toBeNull();
    });

    it('falls back to the numeric uid tail when xtreamId is absent', () => {
        expect(
            getUnifiedCollectionDetailNavigation({
                ...xtreamMovie,
                xtreamId: undefined,
                uid: 'xtream::xtream-1::77',
            })
        ).toEqual({
            link: ['/workspace', 'xtreams', 'xtream-1', 'vod', '42', '77'],
        });
    });

    it('builds a Stalker category route with openStalkerItem state', () => {
        expect(
            getUnifiedCollectionDetailNavigation({
                uid: 'stalker::stalker-1::series-9',
                name: 'Series Nine',
                contentType: 'series',
                sourceType: 'stalker',
                playlistId: 'stalker-1',
                playlistName: 'Stalker Playlist',
                stalkerId: 'series-9',
                categoryId: '44',
                posterUrl: 'https://example.com/poster.png',
            })
        ).toEqual({
            link: ['/workspace', 'stalker', 'stalker-1', 'series', '44'],
            state: {
                openStalkerItem: expect.objectContaining({
                    id: 'series-9',
                    category_id: '44',
                    title: 'Series Nine',
                }),
            },
        });
    });

    it('carries stalkerReturnTo when a returnTo option is passed', () => {
        const navigation = getUnifiedCollectionDetailNavigation(
            {
                uid: 'stalker::stalker-1::movie-5',
                name: 'Movie Five',
                contentType: 'movie',
                sourceType: 'stalker',
                playlistId: 'stalker-1',
                playlistName: 'Stalker Playlist',
                stalkerId: 'movie-5',
            },
            { returnTo: '/workspace/global-recent' }
        );

        expect(navigation?.link).toEqual([
            '/workspace',
            'stalker',
            'stalker-1',
            'vod',
            'vod',
        ]);
        expect(navigation?.state).toEqual(
            expect.objectContaining({
                stalkerReturnTo: '/workspace/global-recent',
            })
        );
    });

    it('returns null for live and m3u items', () => {
        expect(
            getUnifiedCollectionDetailNavigation({
                ...xtreamMovie,
                contentType: 'live',
            })
        ).toBeNull();
        expect(
            getUnifiedCollectionDetailNavigation({
                uid: 'm3u::m3u-1::https://example.com/live.m3u8',
                name: 'Channel One',
                contentType: 'movie',
                sourceType: 'm3u',
                playlistId: 'm3u-1',
                playlistName: 'M3U Playlist',
            })
        ).toBeNull();
    });
});
