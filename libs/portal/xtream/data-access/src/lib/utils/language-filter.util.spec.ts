import {
    getXtreamItemLanguageMetadata,
    getXtreamLanguageOptions,
    getXtreamLanguageOptionsFromCodes,
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

    it('supports include checks and ignores legacy exclude selections', () => {
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
        ).toBe(true);
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

    it('uses English labels by default instead of Italian labels', () => {
        const labelsByCode = new Map(
            getXtreamLanguageOptionsFromCodes(['en', 'it']).map((option) => [
                option.code,
                option.label,
            ])
        );

        expect(labelsByCode.get('en')?.toLowerCase()).toBe('english');
        expect(labelsByCode.get('it')?.toLowerCase()).toBe('italian');
    });

    it('localizes language labels to the selected app language', () => {
        const italianLabelsByCode = new Map(
            getXtreamLanguageOptionsFromCodes(
                ['en', 'it'],
                undefined,
                'it'
            ).map((option) => [option.code, option.label])
        );
        const germanLabelsByCode = new Map(
            getXtreamLanguageOptionsFromCodes(
                ['en', 'it'],
                undefined,
                'de'
            ).map((option) => [option.code, option.label])
        );

        expect(italianLabelsByCode.get('en')?.toLowerCase()).toBe('inglese');
        expect(italianLabelsByCode.get('it')?.toLowerCase()).toBe('italiano');
        expect(germanLabelsByCode.get('en')?.toLowerCase()).toBe('englisch');
        expect(germanLabelsByCode.get('it')?.toLowerCase()).toBe('italienisch');
    });
});
