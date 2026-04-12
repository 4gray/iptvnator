import { faker } from '@faker-js/faker';
import { generateCategories } from './generators/categories.generator.js';
import {
    buildEpgListing,
    buildLiveStream,
    generateEpgListings,
    generateLiveStreams,
    RawEpgListing,
    RawLiveStream,
} from './generators/live.generator.js';
import { generateVodStreams, generateVodDetails, RawVodStream, RawVodDetails } from './generators/vod.generator.js';
import { generateSeriesItems, generateSeriesInfo, RawSeriesItem, RawSeriesInfo } from './generators/series.generator.js';
import { RawCategory } from './generators/categories.generator.js';
import { getScenario, ScenarioConfig } from './scenarios.js';

export interface PortalData {
    scenario: ScenarioConfig;
    liveCategories: RawCategory[];
    vodCategories: RawCategory[];
    seriesCategories: RawCategory[];
    liveStreams: RawLiveStream[];
    vodStreams: RawVodStream[];
    seriesItems: RawSeriesItem[];
    epgListingsByStreamId: Map<number, RawEpgListing[]>;
}

const portalCache = new Map<string, PortalData>();
const vodDetailsCache = new Map<number, RawVodDetails>();
const seriesInfoCache = new Map<number, RawSeriesInfo>();

function generatePortalData(username: string, password: string): PortalData {
    const scenario = getScenario(username, password);
    faker.seed(scenario.seed);

    const { categoryCount, itemsPerCategory, seasonsPerSeries, episodesPerSeason } = scenario;

    let liveCategories = generateCategories('live', categoryCount.live);
    const vodCategories = generateCategories('vod', categoryCount.vod);
    const seriesCategories = generateCategories('series', categoryCount.series);

    const epgListingsByStreamId = new Map<number, RawEpgListing[]>();
    let liveStreams = generateLiveStreams(liveCategories, itemsPerCategory);
    const vodStreams = generateVodStreams(vodCategories, itemsPerCategory);
    const seriesItems = generateSeriesItems(seriesCategories, itemsPerCategory);

    if (scenario.epgFixture === 'timezone-focus') {
        const timezoneFixture = buildTimezoneFixture();
        liveCategories = timezoneFixture.liveCategories;
        liveStreams = timezoneFixture.liveStreams;
        timezoneFixture.epgListingsByStreamId.forEach((listings, streamId) => {
            epgListingsByStreamId.set(streamId, listings);
        });
    }

    // Pre-populate series info cache
    for (const s of seriesItems) {
        if (!seriesInfoCache.has(s.series_id)) {
            seriesInfoCache.set(s.series_id, generateSeriesInfo(s, seasonsPerSeries, episodesPerSeason));
        }
    }

    return {
        scenario,
        liveCategories,
        vodCategories,
        seriesCategories,
        liveStreams,
        vodStreams,
        seriesItems,
        epgListingsByStreamId,
    };
}

export function getPortalData(username: string, password: string): PortalData {
    const key = `${username}:${password}`;
    if (!portalCache.has(key)) {
        portalCache.set(key, generatePortalData(username, password));
    }
    return portalCache.get(key)!;
}

export function getVodDetails(username: string, password: string, vodId: number): RawVodDetails | null {
    if (!vodDetailsCache.has(vodId)) {
        const data = getPortalData(username, password);
        const stream = data.vodStreams.find(v => v.stream_id === vodId);
        if (!stream) return null;
        if (data.scenario.vodDetailsFixture === 'empty-metadata') {
            vodDetailsCache.set(vodId, { info: [] });
            return vodDetailsCache.get(vodId) ?? null;
        }
        vodDetailsCache.set(vodId, generateVodDetails(stream));
    }
    return vodDetailsCache.get(vodId) ?? null;
}

export function getSeriesInfo(username: string, password: string, seriesId: number): RawSeriesInfo | null {
    if (!seriesInfoCache.has(seriesId)) {
        const data = getPortalData(username, password);
        const series = data.seriesItems.find(s => s.series_id === seriesId);
        if (!series) return null;
        const scenario = getScenario(username, password);
        seriesInfoCache.set(seriesId, generateSeriesInfo(series, scenario.seasonsPerSeries, scenario.episodesPerSeason));
    }
    return seriesInfoCache.get(seriesId) ?? null;
}

export function getEpgListings(
    username: string,
    password: string,
    streamId: number
): RawEpgListing[] {
    const data = getPortalData(username, password);
    if (!data.epgListingsByStreamId.has(streamId)) {
        data.epgListingsByStreamId.set(streamId, generateEpgListings(streamId));
    }
    return data.epgListingsByStreamId.get(streamId)!;
}

export function getShortEpgListings(
    username: string,
    password: string,
    streamId: number,
    limit = 12
): RawEpgListing[] {
    const listings = getEpgListings(username, password, streamId);
    const now = Math.floor(Date.now() / 1000);
    const currentIndex = listings.findIndex((listing) => {
        const stopTimestamp = Number.parseInt(listing.stop_timestamp, 10);
        return Number.isFinite(stopTimestamp) && stopTimestamp >= now;
    });

    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    return listings.slice(startIndex, startIndex + Math.max(1, limit));
}

export function resetAll(): void {
    portalCache.clear();
    vodDetailsCache.clear();
    seriesInfoCache.clear();
}

function buildTimezoneFixture(): Pick<
    PortalData,
    'liveCategories' | 'liveStreams' | 'epgListingsByStreamId'
> {
    const primaryCategoryId = '101';
    const secondaryCategoryId = '102';
    const liveCategories: RawCategory[] = [
        {
            category_id: primaryCategoryId,
            category_name: 'EPG Focus',
            parent_id: 0,
        },
        {
            category_id: secondaryCategoryId,
            category_name: 'Overflow Live',
            parent_id: 0,
        },
    ];

    const liveStreams: RawLiveStream[] = [
        buildLiveStream({
            num: 1,
            name: 'Timezone News',
            streamId: 10_000,
            categoryId: primaryCategoryId,
            tvArchive: 1,
            tvArchiveDuration: 3,
        }),
        buildLiveStream({
            num: 2,
            name: 'Night Sports',
            streamId: 10_001,
            categoryId: primaryCategoryId,
        }),
        buildLiveStream({
            num: 3,
            name: 'Archive Cinema',
            streamId: 10_002,
            categoryId: primaryCategoryId,
        }),
        buildLiveStream({
            num: 4,
            name: 'Overflow Live 1',
            streamId: 10_003,
            categoryId: secondaryCategoryId,
        }),
        buildLiveStream({
            num: 5,
            name: 'Overflow Live 2',
            streamId: 10_004,
            categoryId: secondaryCategoryId,
        }),
    ];

    const epgListingsByStreamId = new Map<number, RawEpgListing[]>();
    epgListingsByStreamId.set(10_000, buildTimezoneNewsEpg(10_000));

    return {
        liveCategories,
        liveStreams,
        epgListingsByStreamId,
    };
}

function buildTimezoneNewsEpg(streamId: number): RawEpgListing[] {
    const now = Math.floor(Date.now() / 1000);
    const roundedNow = now - (now % (15 * 60));
    const nextUtcMidnight = getFutureUtcMidnight(now);
    const rawStringOffsetSeconds = -2 * 60 * 60;
    const channelId = `channel-${streamId}.mock`;

    const listings = [
        {
            id: `${streamId}-past`,
            title: 'Earlier Bulletin',
            description: 'Past schedule item used to anchor current-program detection.',
            startTimestamp: roundedNow - 75 * 60,
            stopTimestamp: roundedNow - 15 * 60,
        },
        {
            id: `${streamId}-current`,
            title: 'Global Headlines',
            description: 'Current program for list-row and detail EPG assertions.',
            startTimestamp: roundedNow - 15 * 60,
            stopTimestamp: roundedNow + 15 * 60,
        },
        {
            id: `${streamId}-next`,
            title: 'Market Wrap',
            description: 'Immediate next program for short-EPG preview assertions.',
            startTimestamp: roundedNow + 15 * 60,
            stopTimestamp: roundedNow + 45 * 60,
        },
        {
            id: `${streamId}-later`,
            title: 'Overnight Update',
            description: 'Later same-day program for selected-channel list coverage.',
            startTimestamp: roundedNow + 45 * 60,
            stopTimestamp: roundedNow + 75 * 60,
        },
        {
            id: `${streamId}-boundary-1`,
            title: 'Late Edition',
            description: 'Boundary program spanning UTC midnight for timezone edge cases.',
            startTimestamp: nextUtcMidnight - 30 * 60,
            stopTimestamp: nextUtcMidnight + 30 * 60,
        },
        {
            id: `${streamId}-boundary-2`,
            title: 'After Midnight',
            description: 'Post-midnight program used for next-day navigation checks.',
            startTimestamp: nextUtcMidnight + 30 * 60,
            stopTimestamp: nextUtcMidnight + 90 * 60,
        },
    ];

    return listings
        .sort((left, right) => left.startTimestamp - right.startTimestamp)
        .map((listing) =>
            buildEpgListing({
                id: listing.id,
                epgId: channelId,
                title: listing.title,
                description: listing.description,
                startTimestamp: listing.startTimestamp,
                stopTimestamp: listing.stopTimestamp,
                channelId,
                rawStringOffsetSeconds,
            })
        );
}

function getFutureUtcMidnight(nowSeconds: number): number {
    const nowDate = new Date(nowSeconds * 1000);
    let midnightSeconds = Math.floor(
        Date.UTC(
            nowDate.getUTCFullYear(),
            nowDate.getUTCMonth(),
            nowDate.getUTCDate() + 1,
            0,
            0,
            0
        ) / 1000
    );

    while (midnightSeconds - nowSeconds < 3 * 60 * 60) {
        midnightSeconds += 24 * 60 * 60;
    }

    return midnightSeconds;
}
