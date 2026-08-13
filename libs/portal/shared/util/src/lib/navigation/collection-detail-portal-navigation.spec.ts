import { UnifiedCollectionItem } from '../collection/unified-collection-item.interface';
import {
    getStalkerReturnByHistoryState,
    getUnifiedCollectionDetailNavigation,
    isStalkerReturnByHistoryFor,
} from './collection-detail-portal-navigation';

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

    it('keeps a lazy Ministra VOD is_series item on the VOD route', () => {
        // extractStalkerItemType() reports `series` for the is_series flag, but
        // the lazy season/episode fetch only runs in the VOD catalog.
        expect(
            getUnifiedCollectionDetailNavigation({
                uid: 'stalker::stalker-1::vod-77',
                name: 'Lazy VOD Series',
                contentType: 'series',
                sourceType: 'stalker',
                playlistId: 'stalker-1',
                playlistName: 'Stalker Playlist',
                stalkerId: 'vod-77',
                categoryId: '12',
                stalkerItem: {
                    id: 'vod-77',
                    title: 'Lazy VOD Series',
                    category_id: '12',
                    is_series: '1',
                } as never,
            })?.link
        ).toEqual(['/workspace', 'stalker', 'stalker-1', 'vod', '12']);
    });

    it('keeps an embedded series[] snapshot on the VOD route', () => {
        expect(
            getUnifiedCollectionDetailNavigation({
                uid: 'stalker::stalker-1::vod-88',
                name: 'Embedded Series',
                contentType: 'series',
                sourceType: 'stalker',
                playlistId: 'stalker-1',
                playlistName: 'Stalker Playlist',
                stalkerId: 'vod-88',
                categoryId: '12',
                stalkerItem: {
                    id: 'vod-88',
                    title: 'Embedded Series',
                    category_id: '12',
                    series: [1, 2, 3],
                } as never,
            })?.link
        ).toEqual(['/workspace', 'stalker', 'stalker-1', 'vod', '12']);
    });

    it('normalizes the virtual series category for a VOD-catalog item', () => {
        // Persisted from the series view, so it carries category_id 'series'
        // while still belonging to the VOD catalog.
        expect(
            getUnifiedCollectionDetailNavigation({
                uid: 'stalker::stalker-1::vod-99',
                name: 'Lazy VOD Series',
                contentType: 'series',
                sourceType: 'stalker',
                playlistId: 'stalker-1',
                playlistName: 'Stalker Playlist',
                stalkerId: 'vod-99',
                categoryId: 'series',
                stalkerItem: {
                    id: 'vod-99',
                    title: 'Lazy VOD Series',
                    category_id: 'series',
                    is_series: true,
                } as never,
            })?.link
        ).toEqual(['/workspace', 'stalker', 'stalker-1', 'vod', 'vod']);
    });

    it('still routes a regular Stalker series to the series catalog', () => {
        expect(
            getUnifiedCollectionDetailNavigation({
                uid: 'stalker::stalker-1::series-9',
                name: 'Regular Series',
                contentType: 'series',
                sourceType: 'stalker',
                playlistId: 'stalker-1',
                playlistName: 'Stalker Playlist',
                stalkerId: 'series-9',
                categoryId: '44',
                stalkerItem: {
                    id: 'series-9',
                    title: 'Regular Series',
                    category_id: '44',
                } as never,
            })?.link
        ).toEqual(['/workspace', 'stalker', 'stalker-1', 'series', '44']);
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

    it('binds the history-return marker to the handed-off item', () => {
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

        expect(getStalkerReturnByHistoryState(navigation?.state)).toBe(
            'movie-5'
        );
        expect(isStalkerReturnByHistoryFor(navigation?.state, 'movie-5')).toBe(
            true
        );
        // A lazy episode id keeps its parent identity.
        expect(
            isStalkerReturnByHistoryFor(navigation?.state, 'movie-5:12')
        ).toBe(true);
        // Any other title on the same history entry is a stale match.
        expect(isStalkerReturnByHistoryFor(navigation?.state, 'movie-9')).toBe(
            false
        );
        expect(isStalkerReturnByHistoryFor(navigation?.state, undefined)).toBe(
            false
        );
    });

    it('does not mark the handoff when no returnTo is supplied', () => {
        const navigation = getUnifiedCollectionDetailNavigation({
            uid: 'stalker::stalker-1::movie-5',
            name: 'Movie Five',
            contentType: 'movie',
            sourceType: 'stalker',
            playlistId: 'stalker-1',
            playlistName: 'Stalker Playlist',
            stalkerId: 'movie-5',
        });

        expect(getStalkerReturnByHistoryState(navigation?.state)).toBeNull();
    });

    it('does not treat other navigation state as history-returnable', () => {
        expect(getStalkerReturnByHistoryState(null)).toBeNull();
        expect(getStalkerReturnByHistoryState(undefined)).toBeNull();
        expect(
            getStalkerReturnByHistoryState({
                stalkerReturnTo: '/workspace/dashboard',
            })
        ).toBeNull();
        // A non-string or blank marker carries no identity to bind to.
        expect(
            getStalkerReturnByHistoryState({ stalkerReturnByHistory: true })
        ).toBeNull();
        expect(
            getStalkerReturnByHistoryState({ stalkerReturnByHistory: '   ' })
        ).toBeNull();
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
