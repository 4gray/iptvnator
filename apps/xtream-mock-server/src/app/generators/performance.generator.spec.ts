import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as dataStore from '../data-store.js';
import { getScenario } from '../scenarios.js';

jest.mock('@faker-js/faker', () => {
    const fixedDate = new Date('2020-01-01T00:00:00.000Z');
    const fixedText = 'Fixture value';

    return {
        faker: {
            seed: jest.fn(),
            company: {
                name: () => fixedText,
                catchPhrase: () => fixedText,
            },
            date: {
                past: () => fixedDate,
                recent: () => fixedDate,
            },
            location: { country: () => fixedText },
            lorem: {
                paragraph: () => fixedText,
                sentence: () => fixedText,
                words: () => fixedText,
            },
            music: {
                genre: () => fixedText,
                songName: () => fixedText,
            },
            number: {
                int: ({ min = 0 }: { min?: number }) => min,
            },
            person: { fullName: () => fixedText },
        },
    };
});

const [USERNAME, PASSWORD] = ['performance', 'performance'];
const LOOPBACK_ORIGIN = 'http://127.0.0.1:3211';
jest.setTimeout(30_000);

function serializePerformancePortal(): string {
    const data = dataStore.getPortalData(USERNAME, PASSWORD);
    return JSON.stringify({
        scenario: data.scenario,
        liveCategories: data.liveCategories,
        vodCategories: data.vodCategories,
        seriesCategories: data.seriesCategories,
        liveStreams: data.liveStreams,
        vodStreams: data.vodStreams,
        seriesItems: data.seriesItems,
        epgListingsByStreamId: [...data.epgListingsByStreamId.entries()],
    });
}

function rebuildFingerprint(): { byteCount: number; sha256: string } {
    dataStore.resetAll();
    const serialized = serializePerformancePortal();
    return {
        byteCount: Buffer.byteLength(serialized),
        sha256: createHash('sha256').update(serialized).digest('hex'),
    };
}

function expectLocalOrEmpty(values: string[]): void {
    for (const value of values) {
        expect(value === '' || value.startsWith(`${LOOPBACK_ORIGIN}/`)).toBe(
            true
        );
    }
}

function expectOneThousandItemsPerCategory(
    items: ReadonlyArray<{ category_id: number | string }>
): void {
    const counts = new Map<string, number>();
    for (const item of items) {
        const categoryId = String(item.category_id);
        counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }
    expect([...counts.values()].every((count) => count === 1_000)).toBe(true);
}

describe('performance Xtream fixture', () => {
    it('selects the committed performance scenario', () => {
        expect(getScenario(USERNAME, PASSWORD)).toMatchObject({
            name: 'performance-100k',
            description: 'Deterministic local-only 100k performance catalog',
            seed: 91_001,
            categoryCount: { live: 60, vod: 20, series: 20 },
            itemsPerCategory: 1_000,
            seasonsPerSeries: 1,
            episodesPerSeason: 1,
            accountStatus: 'Active',
            expiryDate: '2099-12-31',
            performanceFixture: 'catalog-100k',
            deferSeriesDetails: true,
        });
    });

    it('contains exactly 100 categories and 100,000 catalog items', () => {
        const data = dataStore.getPortalData(USERNAME, PASSWORD);

        expect([
            data.liveCategories.length,
            data.vodCategories.length,
            data.seriesCategories.length,
        ]).toEqual([60, 20, 20]);
        expect(data.liveStreams).toHaveLength(60_000);
        expect(data.vodStreams).toHaveLength(20_000);
        expect(data.seriesItems).toHaveLength(20_000);
        expectOneThousandItemsPerCategory(data.liveStreams);
        expectOneThousandItemsPerCategory(data.vodStreams);
        expectOneThousandItemsPerCategory(data.seriesItems);
    });

    it('uses unique item IDs and valid category references', () => {
        const data = dataStore.getPortalData(USERNAME, PASSWORD);
        const itemIds = [
            ...data.liveStreams.map((item) => item.stream_id),
            ...data.vodStreams.map((item) => item.stream_id),
            ...data.seriesItems.map((item) => item.series_id),
        ];
        const liveCategoryIds = new Set(
            data.liveCategories.map((category) => category.category_id)
        );
        const vodCategoryIds = new Set(
            data.vodCategories.map((category) => category.category_id)
        );
        const seriesCategoryIds = new Set(
            data.seriesCategories.map((category) => category.category_id)
        );

        expect(new Set(itemIds).size).toBe(100_000);
        expect(
            data.liveStreams.every((item) =>
                liveCategoryIds.has(item.category_id)
            )
        ).toBe(true);
        expect(
            data.vodStreams.every((item) =>
                vodCategoryIds.has(item.category_id)
            )
        ).toBe(true);
        expect(
            data.seriesItems.every((item) =>
                seriesCategoryIds.has(String(item.category_id))
            )
        ).toBe(true);
    });

    it('rebuilds to the identical byte count and SHA-256', () => {
        expect(rebuildFingerprint()).toEqual(rebuildFingerprint());
    });

    it('keeps catalog and detail URL fields local-only', () => {
        dataStore.resetAll();
        const data = dataStore.getPortalData(USERNAME, PASSWORD);
        const vodDetails = dataStore.getVodDetails(
            USERNAME,
            PASSWORD,
            data.vodStreams[0].stream_id
        );
        const seriesInfo = dataStore.getSeriesInfo(
            USERNAME,
            PASSWORD,
            data.seriesItems[0].series_id
        );

        expect(vodDetails).not.toBeNull();
        expect(seriesInfo).not.toBeNull();
        expectLocalOrEmpty([
            ...data.liveStreams.flatMap((item) => [
                item.stream_icon,
                item.direct_source,
            ]),
            ...data.vodStreams.flatMap((item) => [
                item.stream_icon,
                item.direct_source,
            ]),
            ...data.seriesItems.flatMap((item) => [
                item.cover,
                item.youtube_trailer,
                ...item.backdrop_path,
            ]),
            ...(vodDetails && !Array.isArray(vodDetails.info)
                ? [
                      vodDetails.info.kinopoisk_url,
                      vodDetails.info.cover_big,
                      vodDetails.info.movie_image,
                      vodDetails.info.youtube_trailer,
                      ...vodDetails.info.backdrop_path,
                      vodDetails.movie_data?.direct_source ?? '',
                  ]
                : []),
            ...(seriesInfo
                ? [
                      seriesInfo.info.cover,
                      seriesInfo.info.youtube_trailer,
                      ...seriesInfo.info.backdrop_path,
                      ...seriesInfo.seasons.flatMap((season) => [
                          season.cover,
                          season.cover_big,
                      ]),
                      ...Object.values(seriesInfo.episodes).flatMap(
                          (episodes) =>
                              episodes.flatMap((episode) => [
                                  episode.info.movie_image,
                                  episode.direct_source,
                              ])
                      ),
                  ]
                : []),
        ]);
    });

    it('uses the fixed fixture epoch for catalog timestamps', () => {
        const data = dataStore.getPortalData(USERNAME, PASSWORD);

        expect(data.liveStreams[0].added).toBe('1767225600');
        expect(data.vodStreams[0].added).toBe('1767225600');
        expect(data.seriesItems[0].last_modified).toBe('2026-01-01');
    });

    it('does not consult the runtime clock or random source', () => {
        const generatorSource = readFileSync(
            `${__dirname}/performance.generator.ts`,
            'utf8'
        );
        expect(generatorSource).not.toMatch(
            /@faker-js\/faker|\bfaker\b|Date\.now|Math\.random/
        );
        const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => {
            throw new Error('performance fixture used Date.now');
        });
        const mathRandom = jest.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('performance fixture used Math.random');
        });

        try {
            dataStore.resetAll();
            const data = dataStore.getPortalData(USERNAME, PASSWORD);
            dataStore.getVodDetails(
                USERNAME,
                PASSWORD,
                data.vodStreams[0].stream_id
            );
            dataStore.getSeriesInfo(
                USERNAME,
                PASSWORD,
                data.seriesItems[0].series_id
            );
        } finally {
            dateNow.mockRestore();
            mathRandom.mockRestore();
        }
    });

    it('does not eagerly materialize series details and builds one lazily', () => {
        dataStore.resetAll();
        const data = dataStore.getPortalData(USERNAME, PASSWORD);
        const seriesId = data.seriesItems[0].series_id;

        expect(dataStore.getDetailCacheCardinalityForTesting()).toEqual({
            vodDetails: 0,
            seriesInfo: 0,
        });
        dataStore.getSeriesInfo(USERNAME, PASSWORD, seriesId);
        expect(dataStore.getDetailCacheCardinalityForTesting()).toEqual({
            vodDetails: 0,
            seriesInfo: 1,
        });
        expect(
            dataStore.getSeriesInfo(USERNAME, PASSWORD, seriesId)
        ).not.toBeNull();
        expect(dataStore.getDetailCacheCardinalityForTesting()).toEqual({
            vodDetails: 0,
            seriesInfo: 1,
        });
    });

    it('keys VOD details by portal and stream ID', () => {
        dataStore.resetAll();
        const emptyVod = dataStore.getPortalData('emptyvod', 'emptyvod')
            .vodStreams[0];

        expect(
            dataStore.getVodDetails('emptyvod', 'emptyvod', emptyVod.stream_id)
                ?.info
        ).toEqual([]);
        expect(
            dataStore.getVodDetails('user1', 'pass1', emptyVod.stream_id)?.info
        ).not.toEqual([]);
        expect(dataStore.getDetailCacheCardinalityForTesting().vodDetails).toBe(
            2
        );
    });

    it('keys series details by portal and series ID', () => {
        dataStore.resetAll();
        const sharedSeriesId = dataStore.getPortalData('minimal', 'minimal')
            .seriesItems[0].series_id;
        const minimalInfo = dataStore.getSeriesInfo(
            'minimal',
            'minimal',
            sharedSeriesId
        );
        const defaultInfo = dataStore.getSeriesInfo(
            'user1',
            'pass1',
            sharedSeriesId
        );

        expect(minimalInfo?.seasons).toHaveLength(1);
        expect(defaultInfo?.seasons).toHaveLength(3);
        expect(minimalInfo?.episodes['1']).toHaveLength(3);
        expect(defaultInfo?.episodes['1']).toHaveLength(8);
    });
});
