import { TestBed } from '@angular/core/testing';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../services/xtream-api.service';
import { PlaylistsService } from '@iptvnator/services';
import { of } from 'rxjs';

describe('PwaXtreamDataSource', () => {
    let dataSource: PwaXtreamDataSource;
    let apiService: {
        getStreams: jest.Mock;
    };
    let playlistsService: {
        getPlaylistById: jest.Mock;
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
        playlistsService = {
            getPlaylistById: jest.fn(() => of(undefined)),
        };

        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                {
                    provide: XtreamApiService,
                    useValue: apiService,
                },
                {
                    provide: PlaylistsService,
                    useValue: playlistsService,
                },
            ],
        });

        dataSource = TestBed.inject(PwaXtreamDataSource);
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('keeps Xtream passwords out of localStorage playlist metadata', async () => {
        await dataSource.createPlaylist({
            id: 'playlist-1',
            name: 'Xtream PWA',
            serverUrl: credentials.serverUrl,
            username: credentials.username,
            password: credentials.password,
            type: 'xtream',
        });

        const storedPlaylists = JSON.parse(
            localStorage.getItem('xtream-playlists') || '[]'
        );
        expect(storedPlaylists).toEqual([
            expect.not.objectContaining({
                password: credentials.password,
            }),
        ]);
        await expect(dataSource.getPlaylist('playlist-1')).resolves.toEqual(
            expect.objectContaining({
                password: credentials.password,
            })
        );
    });

    it('uses current playlist metadata before stale PWA storage when fetching playlist details', async () => {
        await dataSource.createPlaylist({
            id: 'playlist-1',
            name: 'Old Xtream',
            title: 'Old Xtream',
            serverUrl: 'http://old.example:8080',
            username: 'old-user',
            password: 'old-pass',
            type: 'xtream',
        });
        playlistsService.getPlaylistById.mockReturnValue(
            of({
                _id: 'playlist-1',
                title: 'Updated Xtream',
                importDate: '2026-04-01T00:00:00.000Z',
                lastUsage: '2026-04-01T00:00:00.000Z',
                count: 0,
                autoRefresh: false,
                updateDate: 123,
                serverUrl: 'http://new.example:8080',
                username: 'new-user',
                password: 'new-pass',
                userAgent: 'new-agent',
                referrer: 'https://referrer.example',
                origin: 'https://origin.example',
            })
        );

        await expect(dataSource.getPlaylist('playlist-1')).resolves.toEqual(
            expect.objectContaining({
                id: 'playlist-1',
                name: 'Updated Xtream',
                title: 'Updated Xtream',
                updateDate: 123,
                serverUrl: 'http://new.example:8080',
                username: 'new-user',
                password: 'new-pass',
                userAgent: 'new-agent',
                referrer: 'https://referrer.example',
                origin: 'https://origin.example',
            })
        );
        expect(
            JSON.parse(localStorage.getItem('xtream-playlists') || '[]')
        ).toEqual([
            expect.objectContaining({
                id: 'playlist-1',
                name: 'Updated Xtream',
                title: 'Updated Xtream',
                serverUrl: 'http://new.example:8080',
                username: 'new-user',
                type: 'xtream',
            }),
        ]);
    });

    it('normalizes Xtream API stream identifiers for PWA catalog navigation', async () => {
        apiService.getStreams.mockImplementation(
            (_credentials: XtreamCredentials, type: string) => {
                switch (type) {
                    case 'live':
                        return Promise.resolve([
                            {
                                id: '0',
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
                                id: 0,
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

    it('does not persist zero or invalid Xtream identities as user collections', async () => {
        apiService.getStreams.mockResolvedValue([
            {
                id: 0,
                name: 'Headless Zero',
                category_id: '20',
            },
            {
                id: 'not-a-number',
                name: 'Headless Invalid',
                category_id: '20',
            },
        ]);

        const content = (await dataSource.getContent(
            'playlist-1',
            credentials,
            'movie'
        )) as Array<Record<string, unknown>>;

        expect(content).toEqual([
            expect.objectContaining({
                id: -1,
                xtream_id: -1,
            }),
            expect.objectContaining({
                id: -1,
                xtream_id: -1,
            }),
        ]);

        await dataSource.addFavorite(-1, 'playlist-1');
        await dataSource.addRecentItem(-1, 'playlist-1');

        expect(localStorage.getItem('xtream-favorites')).toBeNull();
        expect(localStorage.getItem('xtream-recent-items')).toBeNull();

        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ 'playlist-1': [-1, 0, 'not-a-number'] })
        );
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                'playlist-1': [
                    {
                        id: -1,
                        viewedAt: '2026-05-21T12:00:00.000Z',
                    },
                    {
                        id: 0,
                        viewedAt: '2026-05-21T12:00:00.000Z',
                    },
                    {
                        id: 'not-a-number',
                        viewedAt: '2026-05-21T12:00:00.000Z',
                    },
                ],
            })
        );

        await expect(dataSource.getFavorites('playlist-1')).resolves.toEqual(
            []
        );
        await expect(dataSource.getRecentItems('playlist-1')).resolves.toEqual(
            []
        );
    });

    it('hydrates stored favorites and recent items from the API when content cache is cold', async () => {
        await dataSource.createPlaylist({
            id: 'playlist-1',
            name: 'Xtream PWA',
            serverUrl: credentials.serverUrl,
            username: credentials.username,
            password: credentials.password,
            type: 'xtream',
        });
        apiService.getStreams.mockImplementation(
            (_credentials: XtreamCredentials, type: string) =>
                Promise.resolve(
                    type === 'movie'
                        ? [
                              {
                                  stream_id: 202,
                                  name: 'Movie One',
                                  stream_icon: 'movie.png',
                                  category_id: '20',
                              },
                          ]
                        : []
                )
        );
        localStorage.setItem(
            'xtream-favorites',
            JSON.stringify({ 'playlist-1': [202] })
        );
        localStorage.setItem(
            'xtream-recent-items',
            JSON.stringify({
                'playlist-1': [
                    {
                        id: 202,
                        viewedAt: '2026-05-21T12:00:00.000Z',
                    },
                ],
            })
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
        expect(apiService.getStreams).toHaveBeenCalledWith(
            credentials,
            'movie'
        );
    });

    it('uses the Xtream stream ID as the PWA content ID when raw id differs', async () => {
        apiService.getStreams.mockResolvedValue([
            {
                id: 5,
                stream_id: 202,
                name: 'Movie One',
                stream_icon: 'movie.png',
                category_id: '20',
            },
        ]);

        const content = (await dataSource.getContent(
            'playlist-1',
            credentials,
            'movie'
        )) as Array<Record<string, unknown>>;

        expect(content[0]).toEqual(
            expect.objectContaining({
                id: 202,
                xtream_id: 202,
            })
        );

        await dataSource.addFavorite(Number(content[0].id), 'playlist-1');
        await dataSource.addRecentItem(Number(content[0].id), 'playlist-1');

        await expect(dataSource.getFavorites('playlist-1')).resolves.toEqual([
            expect.objectContaining({
                id: 202,
                title: 'Movie One',
                xtream_id: 202,
            }),
        ]);
        await expect(dataSource.getRecentItems('playlist-1')).resolves.toEqual([
            expect.objectContaining({
                id: 202,
                title: 'Movie One',
                xtream_id: 202,
            }),
        ]);
    });

    it('backfills PWA recent-item backdrop metadata without rewriting recency', async () => {
        apiService.getStreams.mockResolvedValue([
            {
                stream_id: 202,
                name: 'Movie One',
                stream_icon: 'movie.png',
                category_id: '20',
            },
        ]);

        await dataSource.getContent('playlist-1', credentials, 'movie');
        await dataSource.addRecentItem(202, 'playlist-1');
        const before = JSON.parse(
            localStorage.getItem('xtream-recent-items') || '{}'
        )['playlist-1'][0].viewedAt;

        await dataSource.setContentBackdropIfMissing(
            202,
            'playlist-1',
            ' https://example.com/backdrop.png '
        );

        const stored = JSON.parse(
            localStorage.getItem('xtream-recent-items') || '{}'
        )['playlist-1'][0];
        const storedSnapshot = JSON.parse(
            localStorage.getItem('xtream-collection-items') || '{}'
        )['playlist-1']['202'];
        expect(stored).toEqual(
            expect.objectContaining({
                id: 202,
                backdropUrl: 'https://example.com/backdrop.png',
                viewedAt: before,
            })
        );
        expect(storedSnapshot).toEqual(
            expect.objectContaining({
                backdrop_url: 'https://example.com/backdrop.png',
                title: 'Movie One',
                xtream_id: 202,
            })
        );
        await expect(dataSource.getRecentItems('playlist-1')).resolves.toEqual([
            expect.objectContaining({
                backdrop_url: 'https://example.com/backdrop.png',
                title: 'Movie One',
                xtream_id: 202,
            }),
        ]);
    });

    it('uses stored collection snapshots for fresh-session favorites and recent items', async () => {
        await dataSource.createPlaylist({
            id: 'playlist-1',
            name: 'Xtream PWA',
            serverUrl: credentials.serverUrl,
            username: credentials.username,
            password: credentials.password,
            type: 'xtream',
        });
        apiService.getStreams.mockResolvedValue([
            {
                stream_id: 202,
                name: 'Movie One',
                stream_icon: 'movie.png',
                category_id: '20',
            },
        ]);

        await dataSource.getContent('playlist-1', credentials, 'movie');
        await dataSource.addFavorite(202, 'playlist-1');
        await dataSource.addRecentItem(
            202,
            'playlist-1',
            'https://example.com/backdrop.png'
        );

        const storedCollectionItems = JSON.parse(
            localStorage.getItem('xtream-collection-items') || '{}'
        );
        expect(storedCollectionItems['playlist-1']['202']).toEqual(
            expect.objectContaining({
                title: 'Movie One',
                xtream_id: 202,
            })
        );

        TestBed.resetTestingModule();
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
                {
                    provide: PlaylistsService,
                    useValue: playlistsService,
                },
            ],
        });
        dataSource = TestBed.inject(PwaXtreamDataSource);

        await expect(dataSource.getFavorites('playlist-1')).resolves.toEqual([
            expect.objectContaining({
                title: 'Movie One',
                xtream_id: 202,
            }),
        ]);
        await expect(dataSource.getRecentItems('playlist-1')).resolves.toEqual([
            expect.objectContaining({
                backdrop_url: 'https://example.com/backdrop.png',
                title: 'Movie One',
                xtream_id: 202,
            }),
        ]);
        expect(apiService.getStreams).not.toHaveBeenCalled();
    });
});
