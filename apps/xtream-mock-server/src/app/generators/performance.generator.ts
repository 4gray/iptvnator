import type { RawCategory } from './categories.generator.js';
import type { RawEpgListing, RawLiveStream } from './live.generator.js';
import type {
    RawEpisode,
    RawSeriesInfo,
    RawSeriesItem,
    RawSeason,
} from './series.generator.js';
import type { RawVodDetails, RawVodStream } from './vod.generator.js';

interface PerformancePortalFixture {
    liveCategories: RawCategory[];
    vodCategories: RawCategory[];
    seriesCategories: RawCategory[];
    liveStreams: RawLiveStream[];
    vodStreams: RawVodStream[];
    seriesItems: RawSeriesItem[];
    epgListingsByStreamId: Map<number, RawEpgListing[]>;
}

const FIXED_EPOCH_SECONDS = 1_767_225_600;
const DAY_SECONDS = 86_400;
const ITEMS_PER_CATEGORY = 1_000;
const LIVE_CATEGORY_COUNT = 60;
const VOD_CATEGORY_COUNT = 20;
const SERIES_CATEGORY_COUNT = 20;
const LIVE_CATEGORY_ID_BASE = 91_100;
const VOD_CATEGORY_ID_BASE = 92_100;
const SERIES_CATEGORY_ID_BASE = 93_100;
const LIVE_STREAM_ID_BASE = 1_000_000;
const VOD_STREAM_ID_BASE = 2_000_000;
const SERIES_ID_BASE = 3_000_000;
const EPISODE_ID_BASE = 4_000_000;
const CONTAINER_EXTENSIONS = ['mp4', 'mkv', 'avi'] as const;

export function buildPerformancePortalFixture(): PerformancePortalFixture {
    const liveCategories = buildCategories(
        'Live',
        LIVE_CATEGORY_ID_BASE,
        LIVE_CATEGORY_COUNT
    );
    const vodCategories = buildCategories(
        'VOD',
        VOD_CATEGORY_ID_BASE,
        VOD_CATEGORY_COUNT
    );
    const seriesCategories = buildCategories(
        'Series',
        SERIES_CATEGORY_ID_BASE,
        SERIES_CATEGORY_COUNT
    );

    return {
        liveCategories,
        vodCategories,
        seriesCategories,
        liveStreams: buildLiveStreams(liveCategories),
        vodStreams: buildVodStreams(vodCategories),
        seriesItems: buildSeriesItems(seriesCategories),
        epgListingsByStreamId: new Map(),
    };
}

export function buildPerformanceVodDetails(
    stream: RawVodStream
): RawVodDetails {
    const index = stream.stream_id - VOD_STREAM_ID_BASE;
    const durationSeconds = 5_400 + (index % 1_800);
    const hours = Math.floor(durationSeconds / 3_600);
    const minutes = Math.floor((durationSeconds % 3_600) / 60);

    return {
        info: {
            kinopoisk_url: '',
            tmdb_id: stream.stream_id,
            name: stream.name,
            o_name: stream.name,
            cover_big: '',
            movie_image: '',
            releasedate: dateFromIndex(index),
            episode_run_time: durationSeconds,
            youtube_trailer: '',
            director: `Performance Director ${formatIndex(index)}`,
            actors: `Performance Actor ${formatIndex(index)}`,
            cast: `Performance Actor ${formatIndex(index)}`,
            description: `Synthetic movie ${formatIndex(index)}.`,
            plot: `Synthetic movie ${formatIndex(index)}.`,
            age: '12',
            mpaa_rating: 'PG-13',
            rating_count_kinopoisk: 1_000 + index,
            country: 'Fixtureland',
            genre: `Performance Genre ${index % 10}`,
            backdrop_path: [],
            duration_secs: durationSeconds,
            duration: `${hours}h ${minutes}min`,
            video: ['H.264'],
            audio: ['AAC'],
            bitrate: 2_000 + (index % 4_000),
            rating: stream.rating,
            rating_kinopoisk: stream.rating_imdb,
            rating_imdb: stream.rating_imdb,
        },
        movie_data: {
            stream_id: stream.stream_id,
            name: stream.name,
            added: stream.added,
            category_id: stream.category_id,
            container_extension: stream.container_extension,
            custom_sid: '',
            direct_source: '',
        },
    };
}

export function buildPerformanceSeriesInfo(
    series: RawSeriesItem
): RawSeriesInfo {
    const index = series.series_id - SERIES_ID_BASE;
    const releaseDate = dateFromIndex(index);
    const durationSeconds = 1_500 + (index % 1_800);
    const season: RawSeason = {
        air_date: releaseDate,
        episode_count: 1,
        id: series.series_id * 10 + 1,
        name: 'Season 1',
        overview: `Synthetic season for ${series.name}.`,
        season_number: 1,
        cover: '',
        cover_big: '',
    };
    const episode: RawEpisode = {
        id: String(EPISODE_ID_BASE + index),
        episode_num: 1,
        title: `${series.name} S01E01`,
        container_extension: 'mkv',
        info: {
            tmdb_id: series.series_id,
            releasedate: releaseDate,
            plot: `Synthetic episode for ${series.name}.`,
            duration_secs: durationSeconds,
            duration: `${Math.floor(durationSeconds / 60)}min`,
            movie_image: '',
            bitrate: 1_500 + (index % 5_000),
            rating: ratingFromIndex(index),
        },
        custom_sid: '',
        added: addedFromIndex(index),
        season: 1,
        direct_source: '',
    };

    return {
        seasons: [season],
        info: {
            name: series.name,
            cover: '',
            plot: series.plot,
            cast: series.cast,
            director: series.director,
            genre: series.genre,
            releaseDate: series.releaseDate,
            last_modified: series.last_modified,
            rating: series.rating,
            rating_5based: series.rating_5based,
            backdrop_path: [],
            youtube_trailer: '',
            episode_run_time: series.episode_run_time,
            category_id: String(series.category_id),
        },
        episodes: { '1': [episode] },
    };
}

function buildCategories(
    label: string,
    idBase: number,
    count: number
): RawCategory[] {
    return Array.from({ length: count }, (_, index) => ({
        category_id: String(idBase + index + 1),
        category_name: `Performance ${label} ${String(index + 1).padStart(
            2,
            '0'
        )}`,
        parent_id: 0,
    }));
}

function buildLiveStreams(categories: RawCategory[]): RawLiveStream[] {
    const streams: RawLiveStream[] = [];

    for (const category of categories) {
        for (let itemIndex = 0; itemIndex < ITEMS_PER_CATEGORY; itemIndex++) {
            const index = streams.length;
            const streamId = LIVE_STREAM_ID_BASE + index;
            streams.push({
                num: index + 1,
                name: `Performance Live ${formatIndex(index)}`,
                stream_type: 'live',
                stream_id: streamId,
                stream_icon: '',
                epg_channel_id: `performance-channel-${streamId}`,
                added: addedFromIndex(index),
                category_id: category.category_id,
                custom_sid: '',
                direct_source: '',
                tv_archive: index % 2,
                tv_archive_duration: index % 2 === 0 ? 0 : 3,
                rating_imdb: ratingFromIndex(index).toFixed(1),
            });
        }
    }

    return streams;
}

function buildVodStreams(categories: RawCategory[]): RawVodStream[] {
    const streams: RawVodStream[] = [];

    for (const category of categories) {
        for (let itemIndex = 0; itemIndex < ITEMS_PER_CATEGORY; itemIndex++) {
            const index = streams.length;
            const rating = ratingFromIndex(index);
            streams.push({
                num: index + 1,
                name: `Performance Movie ${formatIndex(index)}`,
                stream_type: 'movie',
                stream_id: VOD_STREAM_ID_BASE + index,
                stream_icon: '',
                added: addedFromIndex(index),
                category_id: category.category_id,
                custom_sid: '',
                direct_source: '',
                rating,
                rating_5based: Number((rating / 2).toFixed(1)),
                rating_imdb: rating.toFixed(1),
                container_extension:
                    CONTAINER_EXTENSIONS[index % CONTAINER_EXTENSIONS.length],
                type: 'movie',
            });
        }
    }

    return streams;
}

function buildSeriesItems(categories: RawCategory[]): RawSeriesItem[] {
    const items: RawSeriesItem[] = [];

    for (const category of categories) {
        for (let itemIndex = 0; itemIndex < ITEMS_PER_CATEGORY; itemIndex++) {
            const index = items.length;
            const rating = ratingFromIndex(index);
            items.push({
                num: index + 1,
                name: `Performance Series ${formatIndex(index)}`,
                series_id: SERIES_ID_BASE + index,
                cover: '',
                plot: `Synthetic series ${formatIndex(index)}.`,
                cast: `Performance Actor ${formatIndex(index)}`,
                director: `Performance Director ${formatIndex(index)}`,
                genre: `Performance Genre ${index % 10}`,
                releaseDate: dateFromIndex(index),
                last_modified: dateFromIndex(index, 30),
                rating: rating.toFixed(1),
                rating_5based: Number((rating / 2).toFixed(1)),
                backdrop_path: [],
                youtube_trailer: '',
                episode_run_time: String(24 + (index % 37)),
                category_id: Number(category.category_id),
            });
        }
    }

    return items;
}

function addedFromIndex(index: number): string {
    return String(FIXED_EPOCH_SECONDS - index);
}

function dateFromIndex(index: number, dayRange = 3_650): string {
    const timestampSeconds =
        FIXED_EPOCH_SECONDS - (index % dayRange) * DAY_SECONDS;
    return new Date(timestampSeconds * 1_000).toISOString().slice(0, 10);
}

function formatIndex(index: number): string {
    return String(index + 1).padStart(6, '0');
}

function ratingFromIndex(index: number): number {
    return Number((6 + (index % 30) / 10).toFixed(1));
}
