import { VodDetailsItem } from '@iptvnator/shared/interfaces';
import { StalkerFavoriteItem } from './models';
import {
    buildStalkerFavoritePayload,
    createStalkerInlineDetailState,
    createStalkerDetailViewState,
    normalizeStalkerFavoriteItem,
    toggleStalkerVodFavorite,
} from './stalker-vod.utils';

describe('stalker-vod.utils regressions', () => {
    it('routes embedded series[] items to series view state', () => {
        const state = createStalkerDetailViewState(
            {
                id: '101',
                cmd: '/media/file_101.mpg',
                series: [1, 2, 3],
                info: {
                    name: 'Series in VOD',
                    movie_image: '',
                    description: '',
                    actors: '',
                    director: '',
                    releasedate: '',
                    genre: '',
                    rating_imdb: '',
                    rating_kinopoisk: '',
                },
            },
            'playlist-1'
        );

        expect(state.itemDetails?.series?.length).toBe(3);
        expect(state.vodDetailsItem).toBeNull();
    });

    it('routes is_series=1 items to series view state (lazy season flow)', () => {
        const state = createStalkerDetailViewState(
            {
                id: '1507',
                cmd: '/media/file_1507.mpg',
                is_series: true,
                info: {
                    name: 'Flagged Series',
                    movie_image: '',
                    description: '',
                    actors: '',
                    director: '',
                    releasedate: '',
                    genre: '',
                    rating_imdb: '',
                    rating_kinopoisk: '',
                },
            },
            'playlist-1'
        );

        expect(state.itemDetails?.is_series).toBe(true);
        expect(state.vodDetailsItem).toBeNull();
    });

    it('builds a playable VOD details item for regular movies', () => {
        const state = createStalkerDetailViewState(
            {
                id: '42',
                cmd: '/media/file_42.mpg',
                info: {
                    name: 'Regular Movie',
                    movie_image: 'poster.jpg',
                    description: '',
                    actors: '',
                    director: '',
                    releasedate: '',
                    genre: '',
                    rating_imdb: '',
                    rating_kinopoisk: '',
                },
            },
            'playlist-1'
        );

        expect(state.itemDetails?.id).toBe('42');
        expect(state.vodDetailsItem).toEqual(
            expect.objectContaining({
                type: 'stalker',
                playlistId: 'playlist-1',
                cmd: '/media/file_42.mpg',
            })
        );
        expect(state.vodDetailsItem?.data.id).toBe('42');
    });

    it('favorite toggle uses completion callback path without delayed state update', () => {
        const addToFavorites = jest.fn(
            (_item: Record<string, unknown>, onDone?: () => void) => {
                onDone?.();
            }
        );
        const removeFromFavorites = jest.fn(
            (_id: string, onDone?: () => void) => {
                onDone?.();
            }
        );
        const onComplete = jest.fn();

        const item = {
            type: 'stalker',
            data: {
                id: '42',
                cmd: '/media/file_42.mpg',
                info: {
                    name: 'Movie',
                    movie_image: '',
                    description: '',
                    actors: '',
                    director: '',
                    releasedate: '',
                    genre: '',
                    rating_imdb: '',
                    rating_kinopoisk: '',
                },
            },
            playlistId: 'playlist-1',
            vodId: 42,
            cmd: '/media/file_42.mpg',
        } as unknown as VodDetailsItem;

        toggleStalkerVodFavorite(
            { item, isFavorite: true },
            { addToFavorites, removeFromFavorites, onComplete }
        );
        expect(addToFavorites).toHaveBeenCalledTimes(1);
        expect(removeFromFavorites).not.toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledTimes(1);

        onComplete.mockClear();
        toggleStalkerVodFavorite(
            { item, isFavorite: false },
            { addToFavorites, removeFromFavorites, onComplete }
        );
        expect(removeFromFavorites).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('preserves the concrete category id in favorite payloads', () => {
        expect(
            buildStalkerFavoritePayload({
                id: '42',
                cmd: '/media/file_42.mpg',
                info: {
                    name: 'Movie',
                    movie_image: '',
                    description: '',
                    actors: '',
                    director: '',
                    releasedate: '',
                    genre: '',
                    rating_imdb: '',
                    rating_kinopoisk: '',
                },
                category_id: '17',
            } as unknown as Parameters<typeof buildStalkerFavoritePayload>[0])
        ).toEqual(
            expect.objectContaining({
                id: '42',
                category_id: '17',
            })
        );
    });

    it('normalizes nested favorite details for the shared inline detail shell', () => {
        const detailState = createStalkerInlineDetailState(
            normalizeStalkerFavoriteItem({
                id: '7',
                category_id: 'vod',
                name: 'Nested Movie',
                details: {
                    id: '7',
                    cmd: '/media/file_7.mpg',
                    series: [11, 12],
                    info: {
                        name: 'Nested Movie',
                        movie_image: '',
                        description: '',
                        actors: '',
                        director: '',
                        releasedate: '',
                        genre: '',
                        rating_imdb: '',
                        rating_kinopoisk: '',
                    },
                },
            } as StalkerFavoriteItem),
            null
        );

        expect(detailState.categoryId).toBe('vod');
        expect(detailState.seriesItem?.series).toEqual([11, 12]);
        expect(detailState.isSeries).toBe(false);
        expect(detailState.vodDetailsItem).toBeNull();
    });

    it('allows search to force series mode when results omit category metadata', () => {
        const detailState = createStalkerInlineDetailState(
            {
                id: '9',
                cmd: '/media/file_9.mpg',
                info: {
                    name: 'Series Result',
                    movie_image: '',
                    description: '',
                    actors: '',
                    director: '',
                    releasedate: '',
                    genre: '',
                    rating_imdb: '',
                    rating_kinopoisk: '',
                },
            },
            null,
            'series'
        );

        expect(detailState.categoryId).toBe('series');
        expect(detailState.seriesItem?.id).toBe('9');
    });
});
