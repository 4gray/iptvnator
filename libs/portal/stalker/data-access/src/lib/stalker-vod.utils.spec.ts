import { VodDetailsItem } from '@iptvnator/shared/interfaces';
import { StalkerFavoriteItem } from './models';
import {
    buildStalkerFavoritePayload,
    firstNonBlankStalkerId,
    firstNonBlankStalkerIdText,
    buildStalkerSelectedVodItem,
    createStalkerInfo,
    createStalkerInlineDetailState,
    createStalkerDetailViewState,
    isStalkerSeriesFlag,
    normalizeStalkerFavoriteItem,
    normalizeStalkerSeriesFlag,
    normalizeStalkerVodDetailsItem,
    toggleStalkerVodFavorite,
} from './stalker-vod.utils';

describe('stalker-vod.utils regressions', () => {
    describe('Stalker series flag contract', () => {
        it.each([true, 1, '1'])(
            'accepts %p and normalizes it to the positive marker',
            (value) => {
                expect(isStalkerSeriesFlag(value)).toBe(true);
                expect(normalizeStalkerSeriesFlag(value)).toBe(true);
            }
        );

        it.each([false, 0, '0', 'true', null, undefined, {}, []])(
            'rejects unsupported value %p',
            (value) => {
                expect(isStalkerSeriesFlag(value)).toBe(false);
                expect(normalizeStalkerSeriesFlag(value)).toBeUndefined();
            }
        );
    });

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
        expect(state.vodDetailsItem?.data).toEqual(
            expect.objectContaining({ id: '42' })
        );
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

    it('preserves TMDB enrichment fields through info re-normalization', () => {
        // Detail views re-normalize the selected item on every render, so
        // every field `mergeStalkerInfoWithTmdb` can set has to survive here
        const tmdbCast = [{ name: 'Rowan Quill', profileUrl: null }];
        const tmdbRecommendations = [
            { tmdbId: 1, title: 'Harbor Static', year: 2021, posterUrl: null },
        ];
        const tmdbGenres = [{ id: 18, name: 'Drama' }];
        const tmdbCountries = [{ code: 'NO', name: 'Norway' }];

        const info = createStalkerInfo({
            id: '7',
            info: {
                name: 'Lantern Coast s05',
                movie_image: 'http://portal/poster.jpg',
                description: 'Plot',
                actors: 'Rowan Quill',
                director: '',
                releasedate: '2026-03-01',
                genre: 'Drama',
                rating_imdb: '',
                rating_kinopoisk: '8.1',
                tmdb_id: 4242,
                tmdb_cast: tmdbCast,
                tmdb_directors: [
                    {
                        name: 'Mara Tollen',
                        profileUrl: null,
                        tmdbPersonId: 1216630,
                    },
                ],
                tmdb_status: 'returning',
                tmdb_backdrop: 'https://image.tmdb.org/t/p/w1280/coast.jpg',
                tmdb_trailer: 'abc123def',
                tmdb_recommendations: tmdbRecommendations,
                tmdb_genres: tmdbGenres,
                tmdb_countries: tmdbCountries,
                tmdb_media_type: 'tv',
                tmdb_supplied_release_date: true,
            },
        });

        expect(info.tmdb_id).toBe(4242);
        expect(info.tmdb_cast).toEqual(tmdbCast);
        expect(info.tmdb_directors?.[0]?.name).toBe('Mara Tollen');
        expect(info.tmdb_status).toBe('returning');
        expect(info.tmdb_backdrop).toBe(
            'https://image.tmdb.org/t/p/w1280/coast.jpg'
        );
        expect(info.tmdb_trailer).toBe('abc123def');
        expect(info.tmdb_recommendations).toEqual(tmdbRecommendations);
        expect(info.tmdb_genres).toEqual(tmdbGenres);
        expect(info.tmdb_countries).toEqual(tmdbCountries);
        expect(info.tmdb_media_type).toBe('tv');
        expect(info.tmdb_supplied_release_date).toBe(true);
    });

    it('adds no TMDB fields to a row that was never enriched', () => {
        const info = createStalkerInfo({
            id: '8',
            info: { name: 'Unenriched Title', releasedate: '2019' },
        });

        expect(
            Object.keys(info).filter((key) => key.startsWith('tmdb_'))
        ).toEqual([]);
    });

    describe('temporary-link flags survive normalization', () => {
        // `buildStalkerSelectedVodItem` is a whitelist, so a field it forgets
        // is silently gone. For these two that fails OPEN: playback and
        // downloads would read "no temporary link needed" and play the
        // portal's non-final URL instead of minting one.
        const FLAGGED_ROW = {
            id: '42',
            cmd: 'ffrt3 http://cdn.example/movie.mkv',
            use_http_tmp_link: '1',
            use_load_balancing: '0',
            info: { name: 'Flagged Movie' },
        };

        it('keeps both flags on the selected VOD item', () => {
            const selected = buildStalkerSelectedVodItem(FLAGGED_ROW);

            expect(selected.use_http_tmp_link).toBe('1');
            expect(selected.use_load_balancing).toBe('0');
        });

        it('keeps both flags through the VOD details normalizer', () => {
            const normalized = normalizeStalkerVodDetailsItem(FLAGGED_ROW);

            expect(normalized.use_http_tmp_link).toBe('1');
            expect(normalized.use_load_balancing).toBe('0');
        });

        it('keeps both flags on a normalized favorite', () => {
            const normalized = normalizeStalkerFavoriteItem(
                FLAGGED_ROW as StalkerFavoriteItem
            );

            expect(normalized.details.use_http_tmp_link).toBe('1');
            expect(normalized.details.use_load_balancing).toBe('0');
        });

        it('leaves an unflagged row without inventing flags', () => {
            const selected = buildStalkerSelectedVodItem({
                id: '43',
                cmd: 'ffrt3 http://cdn.example/other.mkv',
                info: { name: 'Plain Movie' },
            });

            expect(selected.use_http_tmp_link).toBeUndefined();
            expect(selected.use_load_balancing).toBeUndefined();
        });
    });
});

describe('provider placeholders in Stalker VOD info', () => {
    // The series view renders `info` directly and the shared VOD template
    // renders it through the view-model adapter, so the stand-ins have to
    // be gone from `info` itself — not just from one template's guards.
    const PLACEHOLDER_ROW = {
        id: '31',
        cmd: '/media/file_31.mpg',
        name: 'Placeholder Movie',
        o_name: 'N/A',
        screenshot_uri: 'N/A',
        description: 'N/A',
        actors: 'n/a',
        director: '-',
        year: 'N/A',
        genres_str: ' N/A ',
        rating_imdb: 'N/A',
        rating_kinopoisk: '0',
    };

    it('maps every stand-in to the empty value the info shape uses for absent', () => {
        const info = createStalkerInfo(PLACEHOLDER_ROW);

        expect(info).toEqual({
            name: 'Placeholder Movie',
            o_name: undefined,
            movie_image: '',
            description: '',
            actors: '',
            director: '',
            releasedate: '',
            genre: '',
            rating_imdb: '',
            rating_kinopoisk: '',
        });
    });

    it('keeps the series view free of stand-ins through re-normalization', () => {
        const displayed = normalizeStalkerVodDetailsItem(
            normalizeStalkerVodDetailsItem({
                ...PLACEHOLDER_ROW,
                is_series: 1,
            })
        );

        expect(displayed.info.releasedate).toBe('');
        expect(displayed.info.rating_imdb).toBe('');
        expect(displayed.info.rating_kinopoisk).toBe('');
        expect(displayed.info.description).toBe('');
    });

    it('falls through a placeholder to the usable value behind it', () => {
        const info = createStalkerInfo({
            id: '32',
            year: '2011',
            genres_str: 'Drama',
            description: 'Plot from the catalog row',
            rating_imdb: 7.1,
            info: {
                name: 'N/A',
                o_name: 'Original Title',
                releasedate: 'N/A',
                genre: '-',
                description: 'N/A',
                rating_imdb: '0.0',
            },
        });

        expect(info.name).toBe('Original Title');
        expect(info.o_name).toBe('Original Title');
        expect(info.releasedate).toBe('2011');
        expect(info.genre).toBe('Drama');
        expect(info.description).toBe('Plot from the catalog row');
        expect(info.rating_imdb).toBe('7.1');
    });
});

describe('firstNonBlankStalkerId', () => {
    it('skips a blank candidate instead of treating it as set', () => {
        expect(firstNonBlankStalkerId('', '  ', '77')).toBe('77');
        expect(firstNonBlankStalkerId(null, undefined, 42)).toBe(42);
    });

    it('keeps a numeric id as a number so round-trips do not stringify it', () => {
        expect(firstNonBlankStalkerId(12, '99')).toBe(12);
    });

    it('accepts zero, which is a set id and not a blank one', () => {
        expect(firstNonBlankStalkerId(0, '99')).toBe(0);
    });

    it('skips a non-finite number rather than yielding "NaN"', () => {
        expect(firstNonBlankStalkerId(Number.NaN, '5')).toBe('5');
    });

    it('trims the text form and reports nothing when every candidate is blank', () => {
        expect(firstNonBlankStalkerIdText(' 21 ')).toBe('21');
        expect(firstNonBlankStalkerIdText('', null, undefined)).toBe('');
        expect(firstNonBlankStalkerId('', null)).toBeUndefined();
    });
});
