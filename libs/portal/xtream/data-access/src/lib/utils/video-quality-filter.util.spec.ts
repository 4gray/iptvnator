import {
    getXtreamItemVideoQualityBuckets,
    getXtreamVideoQualityOptions,
    getXtreamVideoQualityOptionsFromCounts,
    matchesXtreamVideoQualityFilter,
} from './video-quality-filter.util';

describe('Xtream video quality filter utilities', () => {
    it('extracts quality from media metadata and provider title tags', () => {
        expect(
            getXtreamItemVideoQualityBuckets({
                title: 'Movie 1080p WEB-DL',
                mediaMetadata: {
                    available: true,
                    height: 2160,
                    audioLanguages: [],
                    audioCodecs: [],
                    subtitleLanguages: [],
                    subtitleCodecs: [],
                },
            })
        ).toEqual(['2160p']);
    });

    it('keeps duplicate groups when at least one variant matches the selected quality', () => {
        const item = {
            title: 'Film 1080p',
            duplicateVariants: [
                {
                    title: 'Film 1080p',
                },
                {
                    title: 'Film 2160p UHD',
                },
            ],
        };

        expect(matchesXtreamVideoQualityFilter(item, '2160p')).toBe(true);
        expect(matchesXtreamVideoQualityFilter(item, '720p')).toBe(false);
    });

    it('extracts series episode quality when episode metadata is available', () => {
        const item = {
            title: 'Series',
            episodes: {
                1: [
                    {
                        title: 'Episode 1',
                        info: {
                            video: {
                                height: '1080',
                            },
                        },
                    },
                    {
                        title: 'Episode 2 720p',
                    },
                ],
            },
        };

        expect(getXtreamItemVideoQualityBuckets(item)).toEqual([
            '1080p',
            '720p',
        ]);
    });

    it('keeps the selected quality option visible when the current result set has no match', () => {
        const options = getXtreamVideoQualityOptions([], '2160p');

        expect(options).toEqual([
            {
                value: '2160p',
                label: '2160p+',
                count: 0,
            },
        ]);
    });

    it('localizes the unknown quality label to the selected app language', () => {
        const counts = new Map([['unknown', 2] as const]);
        const english = getXtreamVideoQualityOptionsFromCounts(
            counts,
            'all',
            'en'
        );
        const italian = getXtreamVideoQualityOptionsFromCounts(
            counts,
            'all',
            'it'
        );

        expect(english).toEqual([
            { value: 'unknown', label: 'Not detected', count: 2 },
        ]);
        expect(italian).toEqual([
            { value: 'unknown', label: 'Non rilevata', count: 2 },
        ]);
    });
});
