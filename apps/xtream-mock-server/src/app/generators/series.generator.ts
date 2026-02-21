import { faker } from '@faker-js/faker';
import { RawCategory } from './categories.generator.js';

export interface RawSeriesItem {
    num: number;
    name: string;
    series_id: number;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    releaseDate: string;
    last_modified: string;
    rating: string;
    rating_5based: number;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    category_id: number;
}

export interface RawSeriesInfo {
    seasons: RawSeason[];
    info: RawSeriesInfoMeta;
    episodes: Record<string, RawEpisode[]>;
}

export interface RawSeason {
    air_date: string;
    episode_count: number;
    id: number;
    name: string;
    overview: string;
    season_number: number;
    cover: string;
    cover_big: string;
}

export interface RawEpisode {
    id: string;
    episode_num: number;
    title: string;
    container_extension: string;
    info: {
        tmdb_id: number;
        releasedate: string;
        plot: string;
        duration_secs: number;
        duration: string;
        movie_image: string;
        bitrate: number;
        rating: number;
    };
    custom_sid: string;
    added: string;
    season: number;
    direct_source: string;
}

export interface RawSeriesInfoMeta {
    name: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    releaseDate: string;
    last_modified: string;
    rating: string;
    rating_5based: number;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    category_id: string;
}

const SERIES_ID_BASE = 30_000;
const EPISODE_ID_BASE = 50_000;

export function generateSeriesItems(
    categories: RawCategory[],
    itemsPerCategory: number
): RawSeriesItem[] {
    const items: RawSeriesItem[] = [];
    let num = 1;

    for (const cat of categories) {
        for (let i = 0; i < itemsPerCategory; i++) {
            const seriesId = SERIES_ID_BASE + items.length;
            const rating = (Math.random() * 4 + 5).toFixed(1);
            items.push({
                num: num++,
                name: faker.company.catchPhrase(),
                series_id: seriesId,
                cover: `https://picsum.photos/seed/series-${seriesId}/300/450`,
                plot: faker.lorem.paragraph(),
                cast: Array.from({ length: 4 }, () => faker.person.fullName()).join(', '),
                director: faker.person.fullName(),
                genre: [faker.music.genre(), faker.music.genre()].join(', '),
                releaseDate: faker.date.past({ years: 10 }).toISOString().slice(0, 10),
                last_modified: faker.date.recent({ days: 30 }).toISOString().slice(0, 10),
                rating,
                rating_5based: parseFloat((parseFloat(rating) / 2).toFixed(1)),
                backdrop_path: [
                    `https://picsum.photos/seed/series-bg-${seriesId}/1280/720`,
                ],
                youtube_trailer: '',
                episode_run_time: String(faker.number.int({ min: 22, max: 60 })),
                category_id: parseInt(cat.category_id, 10),
            });
        }
    }
    return items;
}

export function generateSeriesInfo(
    series: RawSeriesItem,
    seasonCount: number,
    episodesPerSeason: number
): RawSeriesInfo {
    const seasons: RawSeason[] = [];
    const episodes: Record<string, RawEpisode[]> = {};
    let episodeCounter = EPISODE_ID_BASE + series.series_id;

    for (let s = 1; s <= seasonCount; s++) {
        const episodeCount = episodesPerSeason;
        seasons.push({
            air_date: faker.date.past({ years: 5 }).toISOString().slice(0, 10),
            episode_count: episodeCount,
            id: series.series_id * 100 + s,
            name: `Season ${s}`,
            overview: faker.lorem.sentence(),
            season_number: s,
            cover: `https://picsum.photos/seed/season-${series.series_id}-${s}/300/450`,
            cover_big: `https://picsum.photos/seed/season-big-${series.series_id}-${s}/500/750`,
        });

        const seasonEpisodes: RawEpisode[] = [];
        for (let e = 1; e <= episodeCount; e++) {
            const durationSecs = faker.number.int({ min: 1200, max: 3600 });
            seasonEpisodes.push({
                id: String(episodeCounter++),
                episode_num: e,
                title: `${series.name} S${s}E${e}`,
                container_extension: 'mkv',
                info: {
                    tmdb_id: faker.number.int({ min: 100, max: 999999 }),
                    releasedate: faker.date.past({ years: 5 }).toISOString().slice(0, 10),
                    plot: faker.lorem.sentence(),
                    duration_secs: durationSecs,
                    duration: `${Math.floor(durationSecs / 60)}min`,
                    movie_image: `https://picsum.photos/seed/ep-${episodeCounter}/300/200`,
                    bitrate: faker.number.int({ min: 1500, max: 8000 }),
                    rating: parseFloat((Math.random() * 3 + 7).toFixed(1)),
                },
                custom_sid: '',
                added: String(Math.floor(Date.now() / 1000 - Math.random() * 1e7)),
                season: s,
                direct_source: '',
            });
        }
        episodes[String(s)] = seasonEpisodes;
    }

    const info: RawSeriesInfoMeta = {
        name: series.name,
        cover: series.cover,
        plot: series.plot,
        cast: series.cast,
        director: series.director,
        genre: series.genre,
        releaseDate: series.releaseDate,
        last_modified: series.last_modified,
        rating: series.rating,
        rating_5based: series.rating_5based,
        backdrop_path: series.backdrop_path,
        youtube_trailer: '',
        episode_run_time: series.episode_run_time,
        category_id: String(series.category_id),
    };

    return { seasons, info, episodes };
}
