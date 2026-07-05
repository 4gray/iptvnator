import {
    detailsFallbackLanguage,
    fillDetailsFromFallback,
    fillSeasonFromFallback,
    seasonNeedsTextFallback,
} from './tmdb-language-fallback';
import { TmdbSeasonDetails } from './tmdb.types';

describe('detailsFallbackLanguage', () => {
    it('returns the original language when the overview is empty', () => {
        expect(
            detailsFallbackLanguage(
                { id: 1, overview: '', original_language: 'ru' },
                'en-US'
            )
        ).toBe('ru');
    });

    it('returns null when the overview is present', () => {
        expect(
            detailsFallbackLanguage(
                { id: 1, overview: 'Plot', original_language: 'ru' },
                'en-US'
            )
        ).toBeNull();
    });

    it('returns null when already fetching in the original language', () => {
        expect(
            detailsFallbackLanguage(
                { id: 1, overview: '', original_language: 'ru' },
                'ru-RU'
            )
        ).toBeNull();
    });

    it('returns null without an original language', () => {
        expect(detailsFallbackLanguage({ id: 1 }, 'en-US')).toBeNull();
    });
});

describe('fillDetailsFromFallback', () => {
    it('fills only the missing overview', () => {
        const merged = fillDetailsFromFallback(
            { id: 1, overview: '', original_language: 'ru' },
            { id: 1, overview: 'Русское описание' }
        );
        expect(merged.overview).toBe('Русское описание');
        expect(merged.original_language).toBe('ru');
    });

    it('keeps an existing overview', () => {
        const merged = fillDetailsFromFallback(
            { id: 1, overview: 'English plot' },
            { id: 1, overview: 'Русское описание' }
        );
        expect(merged.overview).toBe('English plot');
    });
});

describe('season fallback', () => {
    const emptySeason: TmdbSeasonDetails = {
        season_number: 1,
        overview: '',
        episodes: [
            { episode_number: 1, name: 'Episode 1', overview: '' },
            { episode_number: 2, name: '', overview: ' ' },
        ],
    };

    const russianSeason: TmdbSeasonDetails = {
        season_number: 1,
        overview: 'Описание сезона',
        episodes: [
            { episode_number: 1, name: 'Эпизод 1', overview: 'Текст 1' },
            { episode_number: 2, name: 'Эпизод 2', overview: 'Текст 2' },
        ],
    };

    it('detects seasons without any usable text', () => {
        expect(seasonNeedsTextFallback(emptySeason)).toBe(true);
        expect(seasonNeedsTextFallback(russianSeason)).toBe(false);
        expect(
            seasonNeedsTextFallback({
                overview: '',
                episodes: [
                    { episode_number: 1, name: 'Ep 1', overview: 'Text' },
                ],
            })
        ).toBe(false);
    });

    it('triggers when episode overviews exist but ALL names are empty', () => {
        expect(
            seasonNeedsTextFallback({
                overview: 'Season text',
                episodes: [
                    { episode_number: 1, name: '', overview: 'Text 1' },
                    { episode_number: 2, name: ' ', overview: 'Text 2' },
                ],
            })
        ).toBe(true);
    });

    it('fills missing season overview and episode texts by number', () => {
        const merged = fillSeasonFromFallback(emptySeason, russianSeason);
        expect(merged.overview).toBe('Описание сезона');
        expect(merged.episodes?.[0].overview).toBe('Текст 1');
        // Existing (non-empty) names stay in the app language
        expect(merged.episodes?.[0].name).toBe('Episode 1');
        expect(merged.episodes?.[1].name).toBe('Эпизод 2');
    });

    it('is a no-op without a fallback payload', () => {
        expect(fillSeasonFromFallback(emptySeason, null)).toBe(emptySeason);
    });
});
