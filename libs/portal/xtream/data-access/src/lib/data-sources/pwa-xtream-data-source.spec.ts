import { TestBed } from '@angular/core/testing';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../services/xtream-api.service';

describe('PwaXtreamDataSource', () => {
    let dataSource: PwaXtreamDataSource;
    let apiService: {
        getStreams: jest.Mock;
    };

    const credentials: XtreamCredentials = {
        serverUrl: 'http://localhost:3211',
        username: 'demo',
        password: 'secret',
    };

    beforeEach(() => {
        localStorage.clear();

        apiService = {
            getStreams: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                {
                    provide: XtreamApiService,
                    useValue: apiService,
                },
            ],
        });

        dataSource = TestBed.inject(PwaXtreamDataSource);
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('normalizes Xtream API stream identifiers for PWA catalog navigation', async () => {
        apiService.getStreams.mockImplementation(
            (_credentials: XtreamCredentials, type: string) => {
                switch (type) {
                    case 'live':
                        return Promise.resolve([
                            {
                                stream_id: 101,
                                name: 'News Live',
                                stream_icon: 'live.png',
                                category_id: '10',
                                added: '1',
                            },
                        ]);
                    case 'movie':
                        return Promise.resolve([
                            {
                                stream_id: 202,
                                name: 'Movie One',
                                stream_icon: 'movie.png',
                                category_id: '20',
                                added: '2',
                            },
                        ]);
                    case 'series':
                        return Promise.resolve([
                            {
                                series_id: 303,
                                name: 'Series One',
                                cover: 'series.png',
                                category_id: 30,
                                last_modified: '3',
                            },
                        ]);
                    default:
                        return Promise.resolve([]);
                }
            }
        );

        const live = (await dataSource.getContent(
            'playlist-1',
            credentials,
            'live'
        )) as Array<Record<string, unknown>>;
        const vod = (await dataSource.getContent(
            'playlist-1',
            credentials,
            'movie'
        )) as Array<Record<string, unknown>>;
        const series = (await dataSource.getContent(
            'playlist-1',
            credentials,
            'series'
        )) as Array<Record<string, unknown>>;

        expect(live[0]).toEqual(
            expect.objectContaining({
                id: 101,
                stream_id: 101,
                title: 'News Live',
                poster_url: 'live.png',
                type: 'live',
                xtream_id: 101,
            })
        );
        expect(vod[0]).toEqual(
            expect.objectContaining({
                id: 202,
                stream_id: 202,
                title: 'Movie One',
                poster_url: 'movie.png',
                type: 'movie',
                xtream_id: 202,
            })
        );
        expect(series[0]).toEqual(
            expect.objectContaining({
                id: 303,
                series_id: 303,
                title: 'Series One',
                poster_url: 'series.png',
                type: 'series',
                xtream_id: 303,
            })
        );

        await expect(
            dataSource.getContentByXtreamId(202, 'playlist-1', 'movie')
        ).resolves.toEqual(
            expect.objectContaining({
                title: 'Movie One',
                type: 'movie',
                xtream_id: 202,
            })
        );
    });

    it('matches legacy string favorite and recent ids against numeric content identities', async () => {
        apiService.getStreams.mockResolvedValue([
            {
                stream_id: 202,
                name: 'Movie One',
                stream_icon: 'movie.png',
                category_id: '20',
                added: '2',
            },
        ]);
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ 'playlist-1': ['202'] })
        );
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                'playlist-1': [
                    {
                        id: '202',
                        viewedAt: '2026-05-21T12:00:00.000Z',
                    },
                ],
            })
        );

        await dataSource.getContent('playlist-1', credentials, 'movie');

        await expect(dataSource.isFavorite(202, 'playlist-1')).resolves.toBe(
            true
        );
        await expect(dataSource.getFavorites('playlist-1')).resolves.toEqual([
            expect.objectContaining({
                title: 'Movie One',
                xtream_id: 202,
            }),
        ]);
        await expect(dataSource.getRecentItems('playlist-1')).resolves.toEqual([
            expect.objectContaining({
                title: 'Movie One',
                viewed_at: '2026-05-21T12:00:00.000Z',
                xtream_id: 202,
            }),
        ]);
    });
});
