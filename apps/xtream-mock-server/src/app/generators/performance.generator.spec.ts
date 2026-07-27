import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Request, Response } from 'express';
import * as dataStore from '../data-store.js';
import { dispatchAction } from '../routes/dispatch.js';
import { getScenario } from '../scenarios.js';

jest.mock('@faker-js/faker', () => {
    let accessEnabled = false;
    const fixedDate = new Date('2020-01-01T00:00:00.000Z');
    const fixedText = 'Fixture value';
    const deterministicFaker = {
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
    };
    return {
        faker: new Proxy(deterministicFaker, {
            get(target, property, receiver) {
                if (!accessEnabled) {
                    throw new Error(
                        `Performance fixture accessed Faker.${String(property)}`
                    );
                }
                return Reflect.get(target, property, receiver);
            },
        }),
        setFakerAccessForTesting(enabled: boolean) {
            accessEnabled = enabled;
        },
    };
});
const [USERNAME, PASSWORD] = ['performance', 'performance'];
const LOOPBACK_ORIGIN = 'http://127.0.0.1:3211';
jest.setTimeout(30_000);
type PortalData = ReturnType<typeof dataStore.getPortalData>;
type DispatchResult = {
    body: unknown;
    jsonCalls: number;
    statusCode: number;
};
let initialPortal!: PortalData;
function setFakerAccess(enabled: boolean): void {
    const fakerModule = jest.requireMock('@faker-js/faker') as {
        setFakerAccessForTesting(value: boolean): void;
    };
    fakerModule.setFakerAccessForTesting(enabled);
}
function withGenericFaker(run: () => void): void {
    setFakerAccess(true);
    try {
        run();
    } finally {
        dataStore.resetAll();
        setFakerAccess(false);
    }
}
function portalFingerprint(data: PortalData): {
    byteCount: number;
    sha256: string;
} {
    const serialized = JSON.stringify({
        scenario: data.scenario,
        liveCategories: data.liveCategories,
        vodCategories: data.vodCategories,
        seriesCategories: data.seriesCategories,
        liveStreams: data.liveStreams,
        vodStreams: data.vodStreams,
        seriesItems: data.seriesItems,
        epgListingsByStreamId: [...data.epgListingsByStreamId.entries()],
    });
    return {
        byteCount: Buffer.byteLength(serialized),
        sha256: createHash('sha256').update(serialized).digest('hex'),
    };
}
function dispatch(query: Record<string, string>): DispatchResult {
    let body: unknown;
    let jsonCalls = 0;
    let statusCode = 200;
    const response = {
        json(value: unknown) {
            body = value;
            jsonCalls += 1;
            return response;
        },
        status(value: number) {
            statusCode = value;
            return response;
        },
    };
    dispatchAction(
        { query } as unknown as Request,
        response as unknown as Response
    );
    return { body, jsonCalls, statusCode };
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
    beforeAll(() => {
        dataStore.resetAll();
        initialPortal = dataStore.getPortalData(USERNAME, PASSWORD);
    });
    afterAll(() => {
        dataStore.resetAll();
        setFakerAccess(false);
    });
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
        expect([
            initialPortal.liveCategories.length,
            initialPortal.vodCategories.length,
            initialPortal.seriesCategories.length,
        ]).toEqual([60, 20, 20]);
        expect(initialPortal.liveStreams).toHaveLength(60_000);
        expect(initialPortal.vodStreams).toHaveLength(20_000);
        expect(initialPortal.seriesItems).toHaveLength(20_000);
        expectOneThousandItemsPerCategory(initialPortal.liveStreams);
        expectOneThousandItemsPerCategory(initialPortal.vodStreams);
        expectOneThousandItemsPerCategory(initialPortal.seriesItems);
    });

    it('uses unique item IDs and valid category references', () => {
        const itemIds = [
            ...initialPortal.liveStreams.map((item) => item.stream_id),
            ...initialPortal.vodStreams.map((item) => item.stream_id),
            ...initialPortal.seriesItems.map((item) => item.series_id),
        ];
        const liveCategoryIds = new Set(
            initialPortal.liveCategories.map((item) => item.category_id)
        );
        const vodCategoryIds = new Set(
            initialPortal.vodCategories.map((item) => item.category_id)
        );
        const seriesCategoryIds = new Set(
            initialPortal.seriesCategories.map((item) => item.category_id)
        );
        expect(new Set(itemIds).size).toBe(100_000);
        expect(
            initialPortal.liveStreams.every((item) =>
                liveCategoryIds.has(item.category_id)
            )
        ).toBe(true);
        expect(
            initialPortal.vodStreams.every((item) =>
                vodCategoryIds.has(item.category_id)
            )
        ).toBe(true);
        expect(
            initialPortal.seriesItems.every((item) =>
                seriesCategoryIds.has(String(item.category_id))
            )
        ).toBe(true);
    });

    it('rebuilds a distinct portal to the identical byte count and SHA-256', () => {
        const source = readFileSync(
            `${__dirname}/performance.generator.ts`,
            'utf8'
        );
        expect(source).not.toMatch(
            /@faker-js\/faker|\bfaker\b|Date\.now|Math\.random/
        );
        const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => {
            throw new Error('performance fixture used Date.now');
        });
        const mathRandom = jest.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('performance fixture used Math.random');
        });
        try {
            const firstFingerprint = portalFingerprint(initialPortal);
            dataStore.resetAll();
            const rebuiltPortal = dataStore.getPortalData(USERNAME, PASSWORD);

            expect(rebuiltPortal).not.toBe(initialPortal);
            expect(portalFingerprint(rebuiltPortal)).toEqual(firstFingerprint);
        } finally {
            dateNow.mockRestore();
            mathRandom.mockRestore();
        }
    });

    it('keeps catalog and detail URL fields local-only', () => {
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

    it('uses numeric fixed-epoch semantics for catalog timestamps', () => {
        const firstSeries = initialPortal.seriesItems[0];

        expect(initialPortal.liveStreams[0].added).toBe('1767225600');
        expect(initialPortal.vodStreams[0].added).toBe('1767225600');
        expect(
            initialPortal.seriesItems.every((item) =>
                /^\d+$/.test(item.last_modified)
            )
        ).toBe(true);
        expect(firstSeries.last_modified).toBe('1767225600');
        expect(
            new Date(Number(firstSeries.last_modified) * 1_000).toISOString()
        ).toBe('2026-01-01T00:00:00.000Z');
        expect(firstSeries.releaseDate).toBe('2026-01-01');
    });

    it('keeps account-info lazy and materializes one series detail through dispatch', () => {
        dataStore.resetAll();
        const accountResult = dispatch({
            action: 'get_account_info',
            username: USERNAME,
            password: PASSWORD,
        });

        expect([accountResult.statusCode, accountResult.jsonCalls]).toEqual([
            200, 1,
        ]);
        expect(
            (accountResult.body as { user_info?: { username?: string } })
                .user_info?.username
        ).toBe(USERNAME);
        expect(dataStore.getDetailCacheCardinalityForTesting()).toEqual({
            vodDetails: 0,
            seriesInfo: 0,
        });

        const seriesId = dataStore.getPortalData(USERNAME, PASSWORD)
            .seriesItems[0].series_id;
        const seriesResult = dispatch({
            action: 'get_series_info',
            username: USERNAME,
            password: PASSWORD,
            series_id: String(seriesId),
        });
        const seriesBody = seriesResult.body as {
            seasons?: unknown[];
            episodes?: Record<string, unknown[]>;
        };

        expect([seriesResult.statusCode, seriesResult.jsonCalls]).toEqual([
            200, 1,
        ]);
        expect(seriesBody.seasons).toHaveLength(1);
        expect(seriesBody.episodes?.['1']).toHaveLength(1);
        expect(dataStore.getDetailCacheCardinalityForTesting()).toEqual({
            vodDetails: 0,
            seriesInfo: 1,
        });
    });

    it('keys VOD and series details by both username and password', () => {
        withGenericFaker(() => {
            dataStore.resetAll();
            const portals = [
                ['emptyvod', 'emptyvod'],
                ['emptyvod', 'alternate'],
                ['alternate', 'emptyvod'],
            ] as const;
            const firstPortal = dataStore.getPortalData(...portals[0]);
            const vodId = firstPortal.vodStreams[0].stream_id;
            const seriesId = firstPortal.seriesItems[0].series_id;
            const vodDetails = portals.map(([username, password]) =>
                dataStore.getVodDetails(username, password, vodId)
            );
            const seriesDetails = portals.map(([username, password]) =>
                dataStore.getSeriesInfo(username, password, seriesId)
            );
            expect(vodDetails[0]?.info).toEqual([]);
            expect(
                vodDetails.slice(1).every((item) => !Array.isArray(item?.info))
            ).toBe(true);
            expect(seriesDetails.map((item) => item?.seasons.length)).toEqual([
                2, 3, 3,
            ]);
            expect(
                seriesDetails.map((item) => item?.episodes['1'].length)
            ).toEqual([4, 8, 8]);
            expect(
                dataStore.getDetailCacheCardinalityForTesting().vodDetails
            ).toBe(3);
        });
    });
});
