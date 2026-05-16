jest.mock('./source-network-options', () => ({
    ensureSourceNetworkReady: jest.fn().mockResolvedValue(null),
    getSourceAxiosAgents: jest.fn(() => ({})),
    getSourceRequestOptions: jest.fn(() => ({})),
}));

import {
    aggregateSeriesEpisodeMetadata,
    extractSeriesEpisodeDescriptors,
    normalizeMetadataWarmupConcurrency,
} from './media-metadata-background-warmup.service';

describe('media metadata background warmup', () => {
    it('normalizes background probe concurrency to a bounded integer', () => {
        expect(normalizeMetadataWarmupConcurrency(undefined)).toBe(2);
        expect(normalizeMetadataWarmupConcurrency('4')).toBe(4);
        expect(normalizeMetadataWarmupConcurrency(0)).toBe(1);
        expect(normalizeMetadataWarmupConcurrency(99)).toBe(8);
        expect(normalizeMetadataWarmupConcurrency(3.8)).toBe(3);
    });

    it('keeps per-episode quality variants and exposes a single series quality only when all episodes match', () => {
        const mixed = aggregateSeriesEpisodeMetadata([
            {
                available: true,
                qualityLabel: '2160p HEVC',
                height: 2160,
                videoCodec: 'HEVC',
                audioLanguages: ['ITA'],
                audioCodecs: [],
                subtitleLanguages: ['ENG'],
                subtitleCodecs: [],
            },
            {
                available: true,
                qualityLabel: '1080p H.264',
                height: 1080,
                videoCodec: 'H.264',
                audioLanguages: ['ENG'],
                audioCodecs: [],
                subtitleLanguages: [],
                subtitleCodecs: [],
            },
        ]);

        expect(mixed).toEqual(
            expect.objectContaining({
                available: true,
                qualityLabel: undefined,
                qualityLabels: ['2160p HEVC', '1080p H.264'],
                heights: [2160, 1080],
                videoCodecs: ['HEVC', 'H.264'],
                audioLanguages: ['ITA', 'ENG'],
            })
        );

        const uniform = aggregateSeriesEpisodeMetadata([
            {
                available: true,
                qualityLabel: '2160p HEVC',
                height: 2160,
                videoCodec: 'HEVC',
                audioLanguages: ['ITA'],
                audioCodecs: [],
                subtitleLanguages: [],
                subtitleCodecs: [],
            },
            {
                available: true,
                qualityLabel: '2160p HEVC',
                height: 2160,
                videoCodec: 'HEVC',
                audioLanguages: ['ITA'],
                audioCodecs: [],
                subtitleLanguages: [],
                subtitleCodecs: [],
            },
        ]);

        expect(uniform).toEqual(
            expect.objectContaining({
                qualityLabel: '2160p HEVC',
                qualityLabels: ['2160p HEVC'],
                height: 2160,
                videoCodec: 'HEVC',
            })
        );
    });

    it('extracts series episodes from common Xtream payload shapes', () => {
        expect(
            extractSeriesEpisodeDescriptors({
                episodes: [
                    {
                        id: '101',
                        title: 'Pilot',
                    },
                ],
            })
        ).toEqual([
            {
                episode: {
                    id: '101',
                    title: 'Pilot',
                },
            },
        ]);

        expect(
            extractSeriesEpisodeDescriptors({
                episodes: {
                    '1': [
                        {
                            id: '201',
                            title: 'Episode 1',
                        },
                    ],
                    '2': {
                        episode_id: '301',
                        title: 'Episode 2',
                    },
                    specials: {
                        rows: [
                            {
                                stream_id: '401',
                                title: 'Special',
                            },
                        ],
                    },
                },
            })
        ).toEqual([
            {
                episode: {
                    id: '201',
                    title: 'Episode 1',
                },
                seasonKey: '1',
            },
            {
                episode: {
                    episode_id: '301',
                    title: 'Episode 2',
                },
                seasonKey: '2',
            },
            {
                episode: {
                    stream_id: '401',
                    title: 'Special',
                },
                seasonKey: 'specials',
            },
        ]);
    });
});
