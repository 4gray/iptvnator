import {
    formatGridRating,
    resolveGridDuplicateTooltip,
    resolveGridMediaTags,
    resolveGridRating,
    resolveGridRatingTooltip,
} from './grid-list.component';

describe('grid list rating helpers', () => {
    it('rounds numeric ratings to a single decimal place', () => {
        expect(formatGridRating(7.243)).toBe('7.2');
        expect(formatGridRating('6.529')).toBe('6.5');
        expect(formatGridRating('6')).toBe('6.0');
    });

    it('uses the resolved IMDb rating', () => {
        expect(
            resolveGridRating({
                imdbRating: '7.243',
                rating: '6.529',
                rating_imdb: '7.243',
            })
        ).toBe('7.2');
    });

    it('uses provider IMDb ratings when the resolved IMDb rating is blank', () => {
        expect(
            resolveGridRating({
                rating: '5.67',
                rating_imdb: '6.71',
            })
        ).toBe('6.7');
    });

    it('ignores generic provider ratings when IMDb ratings are blank', () => {
        expect(
            resolveGridRating({
                rating: '5.67',
                rating_imdb: '  ',
            })
        ).toBeUndefined();
    });

    it('describes IMDb match provenance for rating audits', () => {
        expect(
            resolveGridRatingTooltip({
                imdbRating: 7.8,
                imdbMatchedTitle: 'Chamber of Secrets',
                imdbMatchedYear: 2002,
                imdbMatchConfidence: 0.91,
                imdbMatchReason: 'localized-title+year',
                imdbVotes: 720000,
            })
        ).toBe(
            'IMDb 7.8: Chamber of Secrets (2002) - confidence 91% - match localized-title+year - 720,000 votes'
        );
    });

    it('describes duplicate grouping and the default quality variant', () => {
        expect(
            resolveGridDuplicateTooltip({
                duplicateCount: 2,
                duplicateGroupKey: 'imdb:tt0295297',
                duplicateQualityLabel: '2160p HEVC MKV',
            })
        ).toBe('2 variants - default 2160p HEVC MKV - key imdb:tt0295297');
    });
});

describe('grid list media tag helpers', () => {
    it('derives quality and language tags from catalog metadata', () => {
        expect(
            resolveGridMediaTags({
                title: 'Film 2160p ITA SUB ENG',
                mediaMetadata: {
                    available: true,
                    qualityLabel: '2160p HEVC',
                    height: 2160,
                    videoCodec: 'HEVC',
                    audioLanguages: ['ITA'],
                    audioCodecs: [],
                    subtitleLanguages: ['ENG'],
                    subtitleCodecs: [],
                },
            })
        ).toEqual(['2160p HEVC', 'Audio ITA', 'Sub ENG']);
    });

    it('aggregates duplicate variants so one card exposes the best known labels', () => {
        expect(
            resolveGridMediaTags({
                title: 'Shared Movie 1080p',
                duplicateVariants: [
                    {
                        title: 'Shared Movie 1080p ITA',
                        audioLanguages: ['ita'],
                    },
                    {
                        title: 'Shared Movie 2160p ENG SUB ITA',
                        mediaMetadata: {
                            available: true,
                            qualityLabel: '2160p',
                            height: 2160,
                            audioLanguages: ['ENG'],
                            audioCodecs: [],
                            subtitleLanguages: ['ITA'],
                            subtitleCodecs: [],
                        },
                    },
                ],
            })
        ).toEqual(['2160p', 'Audio ITA, ENG', 'Sub ITA']);
    });

    it('falls back to title and extension hints when probes are not available', () => {
        expect(
            resolveGridMediaTags({
                title: 'Channel 1080p H265 ITA',
                container_extension: 'm3u8',
            })
        ).toEqual(['1080p HEVC', 'Audio ITA']);
    });
});
