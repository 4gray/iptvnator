import { XtreamVodDetails, XtreamVodStream } from '@iptvnator/shared/interfaces';
import {
    buildXtreamVodFallbackViewModel,
    hasUsableXtreamVodMetadata,
} from './vod-details-fallback.util';

describe('vod-details-fallback.util', () => {
    it('treats populated Xtream info as usable metadata', () => {
        const vodDetails: XtreamVodDetails = {
            info: {
                kinopoisk_url: '',
                tmdb_id: 1,
                name: 'City of McFarland',
                o_name: 'City of McFarland',
                cover_big: 'https://example.com/poster.jpg',
                movie_image: 'https://example.com/poster.jpg',
                releasedate: '2015-02-20',
                episode_run_time: 120,
                youtube_trailer: '',
                director: 'Niki Caro',
                actors: 'Kevin Costner',
                cast: 'Kevin Costner',
                description: 'A real description',
                plot: 'A real plot',
                age: '',
                mpaa_rating: '',
                rating_count_kinopoisk: 0,
                country: 'US',
                genre: 'Drama',
                backdrop_path: ['https://example.com/backdrop.jpg'],
                duration_secs: 7200,
                duration: '02:00:00',
                video: ['H.264'],
                audio: ['AAC'],
                bitrate: 5000,
                rating: 7.4,
                rating_imdb: '7.4',
                rating_kinopoisk: '7.4',
            },
            movie_data: {
                stream_id: 678140,
                name: 'City of McFarland (2015) DE',
                added: '1750671180',
                category_id: '235',
                container_extension: 'mkv',
                custom_sid: null,
                direct_source: '',
            },
        };

        expect(hasUsableXtreamVodMetadata(vodDetails)).toBe(true);
    });

    it('builds a curated fallback model when Xtream returns info as an empty array', () => {
        const catalogItem = {
            name: 'Die Kühe sind Los! (2004) DE',
            stream_id: 650020,
            stream_icon: 'https://example.com/cows.jpg',
            added: '1720000000',
            category_id: '235',
            container_extension: 'mp4',
            rating: 6.1,
            rating_imdb: '6.1',
        } satisfies Partial<XtreamVodStream>;

        const fallback = buildXtreamVodFallbackViewModel({
            vodDetails: { info: [] },
            catalogItem,
            category: {
                category_id: '235',
                category_name: 'DE | DISNEY',
            },
            vodId: 650020,
        });

        expect(hasUsableXtreamVodMetadata({ info: [] })).toBe(false);
        expect(fallback).toEqual({
            added: '2024-07-03',
            facts: [
                {
                    labelKey: 'XTREAM.DETAIL_FALLBACK.STREAM_ID',
                    monospace: true,
                    value: '650020',
                },
                {
                    labelKey: 'XTREAM.DETAIL_FALLBACK.CATEGORY',
                    value: 'DE | DISNEY',
                },
                {
                    labelKey: 'XTREAM.DETAIL_FALLBACK.CONTAINER',
                    monospace: true,
                    value: 'MP4',
                },
            ],
            format: 'MP4',
            posterUrl: 'https://example.com/cows.jpg',
            rating: '6.1',
            title: 'Die Kühe sind Los! (2004) DE',
            year: '2004',
        });
    });

    it('falls back to the route id when movie_data and catalog context are missing', () => {
        const fallback = buildXtreamVodFallbackViewModel({
            vodDetails: {
                info: [],
            } as XtreamVodDetails,
            vodId: 650021,
        });

        expect(fallback).toEqual({
            added: undefined,
            facts: [
                {
                    labelKey: 'XTREAM.DETAIL_FALLBACK.STREAM_ID',
                    monospace: true,
                    value: '650021',
                },
            ],
            format: undefined,
            posterUrl: undefined,
            rating: undefined,
            title: 'VOD 650021',
            year: undefined,
        });
    });

    it('uses preserved catalog fields from the selected item when the details payload is sparse', () => {
        const fallback = buildXtreamVodFallbackViewModel({
            vodDetails: {
                info: [],
                xtream_id: 20000,
                title: "Ain't No Sunshine: venia turbo",
                poster_url: 'https://example.com/sunshine.jpg',
                rating_imdb: '7.7',
                added: '1743984000',
                container_extension: 'avi',
            } as XtreamVodDetails & {
                added?: string;
                container_extension?: string;
                poster_url?: string;
                rating_imdb?: string;
                title?: string;
                xtream_id?: number;
            },
            category: {
                category_name: 'Action',
            },
            vodId: 20000,
        });

        expect(fallback).toEqual({
            added: '2025-04-07',
            facts: [
                {
                    labelKey: 'XTREAM.DETAIL_FALLBACK.STREAM_ID',
                    monospace: true,
                    value: '20000',
                },
                {
                    labelKey: 'XTREAM.DETAIL_FALLBACK.CATEGORY',
                    value: 'Action',
                },
                {
                    labelKey: 'XTREAM.DETAIL_FALLBACK.CONTAINER',
                    monospace: true,
                    value: 'AVI',
                },
            ],
            format: 'AVI',
            posterUrl: 'https://example.com/sunshine.jpg',
            rating: '7.7',
            title: "Ain't No Sunshine: venia turbo",
            year: undefined,
        });
    });
});
