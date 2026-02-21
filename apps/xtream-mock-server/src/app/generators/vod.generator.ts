import { faker } from '@faker-js/faker';
import { RawCategory } from './categories.generator.js';

export interface RawVodStream {
    num: number;
    name: string;
    stream_type: 'movie';
    stream_id: number;
    stream_icon: string;
    added: string;
    category_id: string;
    custom_sid: string;
    direct_source: string;
    rating: number;
    rating_5based: number;
    rating_imdb: string;
    container_extension: string;
    type: 'movie';
}

export interface RawVodDetails {
    info: {
        kinopoisk_url: string;
        tmdb_id: number;
        name: string;
        o_name: string;
        cover_big: string;
        movie_image: string;
        releasedate: string;
        episode_run_time: number;
        youtube_trailer: string;
        director: string;
        actors: string;
        cast: string;
        description: string;
        plot: string;
        age: string;
        mpaa_rating: string;
        rating_count_kinopoisk: number;
        country: string;
        genre: string;
        backdrop_path: string[];
        duration_secs: number;
        duration: string;
        video: string[];
        audio: string[];
        bitrate: number;
        rating: number;
        rating_kinopoisk: string;
        rating_imdb: string;
    };
    movie_data: {
        stream_id: number;
        name: string;
        added: string;
        category_id: string;
        container_extension: string;
        custom_sid: string;
        direct_source: string;
    };
}

const VOD_STREAM_ID_BASE = 20_000;
const CONTAINER_EXTENSIONS = ['mkv', 'mp4', 'avi'];

export function generateVodStreams(
    categories: RawCategory[],
    itemsPerCategory: number
): RawVodStream[] {
    const streams: RawVodStream[] = [];
    let num = 1;

    for (const cat of categories) {
        for (let i = 0; i < itemsPerCategory; i++) {
            const streamId = VOD_STREAM_ID_BASE + streams.length;
            const rating = Math.random() * 4 + 5;
            streams.push({
                num: num++,
                name: faker.music.songName() + ': ' + faker.lorem.words(2),
                stream_type: 'movie',
                stream_id: streamId,
                stream_icon: `https://picsum.photos/seed/vod-${streamId}/300/450`,
                added: String(Math.floor(Date.now() / 1000 - Math.random() * 1e8)),
                category_id: cat.category_id,
                custom_sid: '',
                direct_source: '',
                rating: parseFloat(rating.toFixed(1)),
                rating_5based: parseFloat((rating / 2).toFixed(1)),
                rating_imdb: rating.toFixed(1),
                container_extension: CONTAINER_EXTENSIONS[streamId % CONTAINER_EXTENSIONS.length],
                type: 'movie',
            });
        }
    }
    return streams;
}

export function generateVodDetails(stream: RawVodStream): RawVodDetails {
    const durationSecs = faker.number.int({ min: 3600, max: 9000 });
    const hours = Math.floor(durationSecs / 3600);
    const mins = Math.floor((durationSecs % 3600) / 60);
    return {
        info: {
            kinopoisk_url: '',
            tmdb_id: faker.number.int({ min: 100, max: 999999 }),
            name: stream.name,
            o_name: stream.name,
            cover_big: `https://picsum.photos/seed/vod-big-${stream.stream_id}/500/750`,
            movie_image: `https://picsum.photos/seed/vod-img-${stream.stream_id}/300/450`,
            releasedate: faker.date.past({ years: 20 }).toISOString().slice(0, 10),
            episode_run_time: durationSecs,
            youtube_trailer: '',
            director: faker.person.fullName(),
            actors: Array.from({ length: 5 }, () => faker.person.fullName()).join(', '),
            cast: Array.from({ length: 5 }, () => faker.person.fullName()).join(', '),
            description: faker.lorem.paragraph(),
            plot: faker.lorem.paragraph(),
            age: '16',
            mpaa_rating: 'PG-13',
            rating_count_kinopoisk: faker.number.int({ min: 100, max: 50000 }),
            country: faker.location.country(),
            genre: [faker.music.genre(), faker.music.genre()].join(', '),
            backdrop_path: [
                `https://picsum.photos/seed/vod-backdrop-${stream.stream_id}/1280/720`,
            ],
            duration_secs: durationSecs,
            duration: `${hours}h ${mins}min`,
            video: ['H.264'],
            audio: ['AAC'],
            bitrate: faker.number.int({ min: 1500, max: 8000 }),
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
