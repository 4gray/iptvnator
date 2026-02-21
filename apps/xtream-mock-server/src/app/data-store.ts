import { faker } from '@faker-js/faker';
import { generateCategories } from './generators/categories.generator.js';
import { generateLiveStreams, generateEpgListings, RawLiveStream, RawEpgListing } from './generators/live.generator.js';
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
}

const portalCache = new Map<string, PortalData>();
const vodDetailsCache = new Map<number, RawVodDetails>();
const seriesInfoCache = new Map<number, RawSeriesInfo>();
const epgCache = new Map<number, RawEpgListing[]>();

function generatePortalData(username: string, password: string): PortalData {
    const scenario = getScenario(username, password);
    faker.seed(scenario.seed);

    const { categoryCount, itemsPerCategory, seasonsPerSeries, episodesPerSeason } = scenario;

    const liveCategories = generateCategories('live', categoryCount.live);
    const vodCategories = generateCategories('vod', categoryCount.vod);
    const seriesCategories = generateCategories('series', categoryCount.series);

    const liveStreams = generateLiveStreams(liveCategories, itemsPerCategory);
    const vodStreams = generateVodStreams(vodCategories, itemsPerCategory);
    const seriesItems = generateSeriesItems(seriesCategories, itemsPerCategory);

    // Pre-populate series info cache
    for (const s of seriesItems) {
        if (!seriesInfoCache.has(s.series_id)) {
            seriesInfoCache.set(s.series_id, generateSeriesInfo(s, seasonsPerSeries, episodesPerSeason));
        }
    }

    return { scenario, liveCategories, vodCategories, seriesCategories, liveStreams, vodStreams, seriesItems };
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

export function getEpgListings(streamId: number): RawEpgListing[] {
    if (!epgCache.has(streamId)) {
        epgCache.set(streamId, generateEpgListings(streamId));
    }
    return epgCache.get(streamId)!;
}

export function resetAll(): void {
    portalCache.clear();
    vodDetailsCache.clear();
    seriesInfoCache.clear();
    epgCache.clear();
}
