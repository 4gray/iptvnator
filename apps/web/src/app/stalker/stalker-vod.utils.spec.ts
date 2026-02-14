import { VodDetailsItem } from 'shared-interfaces';
import {
    createStalkerDetailViewState,
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
});
