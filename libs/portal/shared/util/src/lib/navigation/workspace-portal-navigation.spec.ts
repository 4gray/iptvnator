import {
    buildCollectionViewState,
    buildStalkerStateItem,
    buildXtreamItemLink,
    COLLECTION_VIEW_STATE_KEY,
    getGlobalFavoriteNavigation,
    getCollectionViewState,
    getOpenCollectionDetailItemState,
    getOpenLiveCollectionItemState,
    getOpenStalkerItemState,
    getRecentItemNavigation,
    getStalkerReturnToState,
    getUnifiedCollectionNavigation,
    OPEN_COLLECTION_DETAIL_STATE_KEY,
    matchesOpenLiveCollectionItem,
    OPEN_LIVE_COLLECTION_ITEM_STATE_KEY,
    OPEN_STALKER_ITEM_STATE_KEY,
    STALKER_RETURN_TO_STATE_KEY,
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
        ).toEqual(['/workspace', 'xtreams', 'xtream-1', 'vod', '42', '99']);
    });

    it('normalizes collection view state for history persistence', () => {
        expect(
            buildCollectionViewState({
                selectedContentType: 'movie',
                scope: 'all',
            })
        ).toEqual({
            selectedContentType: 'movie',
            scope: 'all',
        });
        expect(
            getCollectionViewState({
                [COLLECTION_VIEW_STATE_KEY]: {
                    selectedContentType: 'series',
                    scope: 'playlist',
                },
            })
        ).toEqual({
            selectedContentType: 'series',
            scope: 'playlist',
        });
    });

    it('routes live M3U favorites to the playlist favorites collection with auto-open state', () => {
        const navigation = getGlobalFavoriteNavigation({
            id: 'channel-1',
            title: 'Channel One',
            type: 'live',
            playlist_id: 'm3u-1',
            category_id: 'live',
            xtream_id: 'channel-1',
            source: 'm3u',
            poster_url: 'https://example.com/logo.png',
            added_at: '2026-03-01T00:00:00.000Z',
        });

        expect(navigation).toEqual({
            link: ['/workspace', 'playlists', 'm3u-1', 'favorites'],
            state: {
                openLiveCollectionItem: {
                    contentType: 'live',
                    sourceType: 'm3u',
                    playlistId: 'm3u-1',
                    itemId: 'channel-1',
                    title: 'Channel One',
                    imageUrl: 'https://example.com/logo.png',
                },
            },
        });
        expect(getOpenLiveCollectionItemState(navigation.state)).toEqual(
            navigation.state?.[OPEN_LIVE_COLLECTION_ITEM_STATE_KEY]
        );
    });

    it('routes Stalker movie favorites into the global favorites page with inline detail state', () => {
        const navigation = getGlobalFavoriteNavigation({
            id: 'movie-7',
            title: 'Movie Seven',
            type: 'movie',
            playlist_id: 'stalker-1',
            category_id: '17',
            xtream_id: 'movie-7',
            source: 'stalker',
            poster_url: 'https://example.com/poster.png',
            added_at: '2026-03-01T00:00:00.000Z',
        });

        expect(navigation).toEqual({
            link: ['/workspace', 'global-favorites'],
            state: {
                openCollectionDetailItem: {
                    item: expect.objectContaining({
                        uid: 'stalker::stalker-1::movie-7',
                        name: 'Movie Seven',
                        contentType: 'movie',
                        sourceType: 'stalker',
                        playlistId: 'stalker-1',
                        categoryId: '17',
                        stalkerId: 'movie-7',
                    }),
                },
            },
        });
        expect(getOpenCollectionDetailItemState(navigation.state)).toEqual(
            navigation.state?.[OPEN_COLLECTION_DETAIL_STATE_KEY]
        );
    });

    it('routes Stalker live recents to the collection route with auto-open state', () => {
        const navigation = getRecentItemNavigation({
            id: 'stalker-live-1',
            title: 'Live One',
            type: 'live',
            playlist_id: 'stalker-1',
            category_id: 'itv',
            xtream_id: 'stalker-live-1',
            source: 'stalker',
            poster_url: 'https://example.com/poster.png',
            viewed_at: '2026-03-01T00:00:00.000Z',
        });

        expect(navigation).toEqual({
            link: ['/workspace', 'stalker', 'stalker-1', 'recent'],
            state: {
                openLiveCollectionItem: {
                    contentType: 'live',
                    sourceType: 'stalker',
                    playlistId: 'stalker-1',
                    itemId: 'stalker-live-1',
                    title: 'Live One',
                    imageUrl: 'https://example.com/poster.png',
                },
            },
        });
    });

    it('matches collection live state against multiple live item identifiers', () => {
        expect(
            matchesOpenLiveCollectionItem(
                {
                    uid: 'm3u::m3u-1::https://example.com/live.m3u8',
                    name: 'Channel One',
                    contentType: 'live',
                    sourceType: 'm3u',
                    playlistId: 'm3u-1',
                    playlistName: 'M3U Playlist',
                    streamUrl: 'https://example.com/live.m3u8',
                    channelId: 'channel-1',
                },
                {
                    contentType: 'live',
                    sourceType: 'm3u',
                    playlistId: 'm3u-1',
                    itemId: 'channel-1',
                    title: 'Channel One',
                }
            )
        ).toBe(true);
    });

    it('builds unified Stalker grid navigation with detail state', () => {
        expect(
            getUnifiedCollectionNavigation({
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
                    category_id: '44',
                    id: 'series-9',
                    title: 'Series Nine',
                }),
            },
        });
    });

    it('preserves concrete Stalker category ids when building detail state', () => {
        expect(
            buildStalkerStateItem(
                {
                    id: '77',
                    category_id: '101',
                    title: 'Concrete Category Movie',
                },
                {
                    id: '77',
                    title: 'Concrete Category Movie',
                    type: 'movie',
                }
            )
        ).toEqual(
            expect.objectContaining({
                id: '77',
                category_id: '101',
                title: 'Concrete Category Movie',
            })
        );
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
