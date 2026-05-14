import {
    getXtreamItemLanguageMetadata,
    getXtreamLanguageOptions,
    matchesXtreamLanguageFilter,
} from './language-filter.util';

describe('Xtream language filter utilities', () => {
    it('extracts audio and subtitle languages from metadata and provider tags', () => {
        const item = {
            title: 'IT - Movie 2160p SUB ENG',
            mediaMetadata: {
                available: true,
                audioLanguages: ['ITA'],
                audioCodecs: [],
                subtitleLanguages: [],
                subtitleCodecs: [],
            },
        };

        expect(getXtreamItemLanguageMetadata(item)).toEqual({
            audioLanguages: ['it'],
            subtitleLanguages: ['en'],
        });
    });

    it('keeps duplicate groups when at least one variant satisfies the filter', () => {
        const item = {
            title: 'Film ITA 1080p',
            duplicateVariants: [
                {
                    title: 'Film ITA 1080p',
                    audioLanguages: ['ITA'],
                },
                {
                    title: 'Film ENG 2160p',
                    audioLanguages: ['ENG'],
                },
            ],
        };

        expect(
            matchesXtreamLanguageFilter(item, {
                audioInclude: ['en'],
                audioExclude: [],
                subtitleInclude: [],
                subtitleExclude: [],
            })
        ).toBe(true);
        expect(
            matchesXtreamLanguageFilter(item, {
                audioInclude: ['fr'],
                audioExclude: [],
                subtitleInclude: [],
                subtitleExclude: [],
            })
        ).toBe(false);
    });

    it('supports include and exclude checks for subtitles', () => {
        const item = {
            title: 'Movie SUB ITA',
        };

        expect(
            matchesXtreamLanguageFilter(item, {
                audioInclude: [],
                audioExclude: [],
                subtitleInclude: ['it'],
                subtitleExclude: [],
            })
        ).toBe(true);
        expect(
            matchesXtreamLanguageFilter(item, {
                audioInclude: [],
                audioExclude: [],
                subtitleInclude: [],
                subtitleExclude: ['it'],
            })
        ).toBe(false);
    });

    it('keeps selected language options visible even when not detected yet', () => {
        const options = getXtreamLanguageOptions([], {
            audioInclude: ['fr'],
            audioExclude: [],
            subtitleInclude: [],
            subtitleExclude: [],
        });

        expect(options.some((option) => option.code === 'fr')).toBe(true);
    });
});
