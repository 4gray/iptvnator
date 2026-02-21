import { faker } from '@faker-js/faker';
import { ScenarioConfig } from './scenarios.js';

// ---------------------------------------------------------------------------
// Shared types (mirror the Stalker API response shapes)
// ---------------------------------------------------------------------------

export interface RawCategory {
    id: string;
    title: string;
    alias: string;
}

export interface RawChannel {
    id: string;
    name: string;
    o_name: string;
    cmd: string;
    logo: string;
    category_id: string;
    tv_genre_id: string;
    xmltv_id: string;
}

export interface RawVodItem {
    id: string;
    name: string;
    o_name: string;
    title: string;
    cmd: string;
    screenshot_uri: string;
    cover: string;
    description: string;
    actors: string;
    director: string;
    year: string;
    genre: string;
    genres_str: string;
    rating_imdb: string;
    rating_kinopoisk: string;
    category_id: string;
    is_series: 0 | 1 | '1';
    has_files: number;
    series?: RawEmbeddedEpisode[];
}

export interface RawSeriesItem {
    id: string;
    name: string;
    o_name: string;
    title: string;
    cmd: string;
    screenshot_uri: string;
    cover: string;
    description: string;
    actors: string;
    director: string;
    year: string;
    genres_str: string;
    rating_imdb: string;
    rating_kinopoisk: string;
    category_id: string;
    is_series: 0;
    has_files: 0;
}

export interface RawSeason {
    id: string;
    name: string;
    cmd: string;
    description: string;
    director: string;
    actors: string;
    year: string;
    genres_str: string;
    age: string;
    rating_imdb: string;
    rating_kinopoisk: string;
    screenshot_uri: string;
    added: string;
    series: string[];
}

export interface RawEmbeddedEpisode {
    id: number;
    name: string;
    cmd: string;
}

export interface RawEpgProgram {
    id: string;
    name: string;
    start: string;
    stop: string;
    start_timestamp: number;
    stop_timestamp: number;
    descr: string;
    category: string;
}

export interface GeneratedPortalData {
    itvCategories: RawCategory[];
    vodCategories: RawCategory[];
    seriesCategories: RawCategory[];
    channels: Map<string, RawChannel[]>; // categoryId -> channels
    vod: Map<string, RawVodItem[]>;       // categoryId -> items
    series: Map<string, RawSeriesItem[]>; // categoryId -> items
    seasons: Map<string, RawSeason[]>;    // seriesItemId -> seasons
    epg: Map<string, RawEpgProgram[]>;    // channelId -> programs
}

// ---------------------------------------------------------------------------
// Public test HLS streams used for create_link responses
// ---------------------------------------------------------------------------
const TEST_HLS_STREAMS = [
    'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
    'https://playertest.longtailvideo.com/adaptive/oceans/oceans.m3u8',
    'https://playertest.longtailvideo.com/adaptive/bbbfull/bbbfull.m3u8',
];

function pickStream(index: number): string {
    return TEST_HLS_STREAMS[index % TEST_HLS_STREAMS.length];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function coverUrl(seed: string, width = 300, height = 200): string {
    return `https://picsum.photos/seed/${seed}/${width}/${height}`;
}

function logoUrl(seed: string): string {
    return `https://picsum.photos/seed/logo-${seed}/100/100`;
}

function isoNow(offsetMinutes: number): string {
    const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
    return d.toISOString();
}

function unixNow(offsetMinutes: number): number {
    return Math.floor((Date.now() + offsetMinutes * 60 * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function generatePortalData(config: ScenarioConfig): GeneratedPortalData {
    faker.seed(config.seed);

    const data: GeneratedPortalData = {
        itvCategories: [],
        vodCategories: [],
        seriesCategories: [],
        channels: new Map(),
        vod: new Map(),
        series: new Map(),
        seasons: new Map(),
        epg: new Map(),
    };

    // ------ ITV categories + channels ------
    data.itvCategories = generateCategories('itv', config.categoryCount.itv);
    let channelIndex = 0;
    for (const cat of data.itvCategories) {
        const channels = generateChannels(cat.id, config.itemsPerCategory, channelIndex);
        data.channels.set(cat.id, channels);
        for (const ch of channels) {
            data.epg.set(ch.id, generateEpg(ch.name));
        }
        channelIndex += config.itemsPerCategory;
    }

    // ------ VOD categories + items ------
    data.vodCategories = generateCategories('vod', config.categoryCount.vod);
    let vodIndex = 0;
    for (const cat of data.vodCategories) {
        const items = generateVodItems(
            cat.id,
            config.itemsPerCategory,
            vodIndex,
            config.isSeriesFraction,
            config.embeddedSeriesFraction,
            config.seasonsPerSeries,
            config.episodesPerSeason
        );
        data.vod.set(cat.id, items);
        vodIndex += config.itemsPerCategory;
    }

    // ------ Series categories + items ------
    data.seriesCategories = generateCategories('series', config.categoryCount.series);
    let seriesIndex = 0;
    for (const cat of data.seriesCategories) {
        const items = generateSeriesItems(cat.id, config.itemsPerCategory, seriesIndex);
        data.series.set(cat.id, items);
        for (const item of items) {
            data.seasons.set(item.id, generateSeasons(item, config.seasonsPerSeries, config.episodesPerSeason));
        }
        seriesIndex += config.itemsPerCategory;
    }

    return data;
}

// ---------------------------------------------------------------------------
// Category generators
// ---------------------------------------------------------------------------

const ITV_GENRE_NAMES = [
    'News', 'Sports', 'Movies', 'Entertainment', 'Kids',
    'Documentary', 'Music', 'Comedy', 'Drama', 'Reality TV',
    'Lifestyle', 'Travel', 'Food', 'Tech', 'Science',
    'History', 'Nature', 'Animation', 'Gaming', 'Shopping',
];

const VOD_GENRE_NAMES = [
    'Action', 'Comedy', 'Drama', 'Horror', 'Thriller',
    'Romance', 'Sci-Fi', 'Fantasy', 'Animation', 'Documentary',
    'Biography', 'Crime', 'Mystery', 'Adventure', 'Family',
    'War', 'Western', 'Musical', 'Sport', 'History',
];

const SERIES_GENRE_NAMES = [
    'Drama Series', 'Comedy Series', 'Crime Series', 'Sci-Fi Series',
    'Reality Shows', 'Anime', 'Soap Opera', 'Mini Series',
    'Documentary Series', 'Kids Shows', 'Action Series', 'Fantasy Series',
    'Medical', 'Legal', 'Political', 'Romance Series', 'Historical',
    'Thriller Series', 'Horror Series', 'Western Series',
];

function getGenreNames(type: 'itv' | 'vod' | 'series'): string[] {
    if (type === 'itv') return ITV_GENRE_NAMES;
    if (type === 'vod') return VOD_GENRE_NAMES;
    return SERIES_GENRE_NAMES;
}

function generateCategories(type: 'itv' | 'vod' | 'series', count: number): RawCategory[] {
    const names = getGenreNames(type);
    return Array.from({ length: count }, (_, i) => {
        const id = String((type === 'itv' ? 1000 : type === 'vod' ? 2000 : 3000) + i + 1);
        const title = names[i % names.length];
        return { id, title, alias: title.toLowerCase().replace(/\s+/g, '_') };
    });
}

// ---------------------------------------------------------------------------
// Channel generators
// ---------------------------------------------------------------------------

function generateChannels(categoryId: string, count: number, startIndex: number): RawChannel[] {
    return Array.from({ length: count }, (_, i) => {
        const globalIndex = startIndex + i;
        const id = String(10000 + globalIndex);
        const name = `${faker.company.name()} TV`;
        return {
            id,
            name,
            o_name: name,
            cmd: `ffrt4://ch/live/${id}/index.m3u8`,
            logo: logoUrl(`ch-${id}`),
            category_id: categoryId,
            tv_genre_id: categoryId,
            xmltv_id: `channel-${id}.example`,
        };
    });
}

// ---------------------------------------------------------------------------
// VOD generators
// ---------------------------------------------------------------------------

function generateVodItems(
    categoryId: string,
    count: number,
    startIndex: number,
    isSeriesFraction: number,
    embeddedSeriesFraction: number,
    seasonsPerSeries: number,
    episodesPerSeason: number
): RawVodItem[] {
    return Array.from({ length: count }, (_, i) => {
        const globalIndex = startIndex + i;
        const id = String(20000 + globalIndex);
        const title = faker.music.songName() + ': ' + faker.lorem.words(2);
        const isSeries = i / count < isSeriesFraction;
        const hasEmbeddedSeries = !isSeries && (i / count < isSeriesFraction + embeddedSeriesFraction);

        const item: RawVodItem = {
            id,
            name: title,
            o_name: title,
            title,
            cmd: `ffrt4://vod/${id}/index.m3u8`,
            screenshot_uri: coverUrl(`vod-${id}`),
            cover: coverUrl(`vod-cover-${id}`, 300, 450),
            description: faker.lorem.paragraph(),
            actors: Array.from({ length: 4 }, () => faker.person.fullName()).join(', '),
            director: faker.person.fullName(),
            year: String(faker.date.past({ years: 20 }).getFullYear()),
            genre: faker.music.genre(),
            genres_str: [faker.music.genre(), faker.music.genre()].join(', '),
            rating_imdb: (Math.random() * 4 + 5).toFixed(1),
            rating_kinopoisk: (Math.random() * 4 + 5).toFixed(1),
            category_id: categoryId,
            is_series: isSeries ? '1' : 0,
            has_files: isSeries ? 0 : 1,
        };

        if (hasEmbeddedSeries) {
            item.series = generateEmbeddedEpisodes(id, seasonsPerSeries * episodesPerSeason);
        }

        return item;
    });
}

function generateEmbeddedEpisodes(parentId: string, count: number): RawEmbeddedEpisode[] {
    return Array.from({ length: count }, (_, i) => ({
        id: parseInt(parentId) * 100 + i,
        name: `Episode ${i + 1}`,
        cmd: `ffrt4://vod/${parentId}/ep${i + 1}/index.m3u8`,
    }));
}

// ---------------------------------------------------------------------------
// Series generators
// ---------------------------------------------------------------------------

function generateSeriesItems(categoryId: string, count: number, startIndex: number): RawSeriesItem[] {
    return Array.from({ length: count }, (_, i) => {
        const globalIndex = startIndex + i;
        const id = String(30000 + globalIndex);
        const title = faker.company.catchPhrase();
        return {
            id,
            name: title,
            o_name: title,
            title,
            cmd: `ffrt4://series/${id}`,
            screenshot_uri: coverUrl(`series-${id}`),
            cover: coverUrl(`series-cover-${id}`, 300, 450),
            description: faker.lorem.paragraph(),
            actors: Array.from({ length: 4 }, () => faker.person.fullName()).join(', '),
            director: faker.person.fullName(),
            year: String(faker.date.past({ years: 10 }).getFullYear()),
            genres_str: [faker.music.genre(), faker.music.genre()].join(', '),
            rating_imdb: (Math.random() * 4 + 5).toFixed(1),
            rating_kinopoisk: (Math.random() * 4 + 5).toFixed(1),
            category_id: categoryId,
            is_series: 0,
            has_files: 0,
        };
    });
}

export function generateSeasons(
    series: RawSeriesItem,
    seasonCount: number,
    episodesPerSeason: number
): RawSeason[] {
    return Array.from({ length: seasonCount }, (_, s) => {
        const seasonId = `${series.id}-s${s + 1}`;
        const episodes = Array.from({ length: episodesPerSeason }, (_, e) =>
            `${series.id}-s${s + 1}-e${e + 1}`
        );
        return {
            id: seasonId,
            name: `Season ${s + 1}`,
            cmd: `ffrt4://series/${series.id}/season/${s + 1}`,
            description: faker.lorem.sentence(),
            director: series.director,
            actors: series.actors,
            year: series.year,
            genres_str: series.genres_str,
            age: '16',
            rating_imdb: series.rating_imdb,
            rating_kinopoisk: series.rating_kinopoisk,
            screenshot_uri: coverUrl(`${seasonId}`),
            added: new Date(Date.now() - Math.random() * 1e10).toISOString(),
            series: episodes,
        };
    });
}

// ---------------------------------------------------------------------------
// EPG generator
// ---------------------------------------------------------------------------

const EPG_PROGRAM_TYPES = ['News', 'Movie', 'Documentary', 'Entertainment', 'Sports', 'Kids', 'Series'];

export function generateEpg(channelName: string): RawEpgProgram[] {
    const programs: RawEpgProgram[] = [];
    // Generate 12 programs: 6 past, current, 5 future (30-min slots)
    const SLOT_MINUTES = 30;
    const startOffset = -6 * SLOT_MINUTES; // start 3 hours ago

    for (let i = 0; i < 12; i++) {
        const startMin = startOffset + i * SLOT_MINUTES;
        const stopMin = startMin + SLOT_MINUTES;
        const category = EPG_PROGRAM_TYPES[i % EPG_PROGRAM_TYPES.length];
        programs.push({
            id: String(i + 1),
            name: `${channelName}: ${faker.company.catchPhrase()}`,
            start: isoNow(startMin),
            stop: isoNow(stopMin),
            start_timestamp: unixNow(startMin),
            stop_timestamp: unixNow(stopMin),
            descr: faker.lorem.sentence(),
            category,
        });
    }
    return programs;
}

// ---------------------------------------------------------------------------
// create_link helper
// ---------------------------------------------------------------------------

export function resolveStreamUrl(cmd: string, itemIndex: number): string {
    if (cmd.startsWith('ffrt4://')) {
        return pickStream(itemIndex);
    }
    return pickStream(0);
}
