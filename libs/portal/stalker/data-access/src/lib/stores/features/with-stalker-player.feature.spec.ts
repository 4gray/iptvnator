import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService } from '@iptvnator/services';
import { of } from 'rxjs';
import {
    PlaylistMeta,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { withStalkerPlayer } from './with-stalker-player.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    ...jest.requireActual('@iptvnator/portal/shared/util'),
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const PLAYLIST = {
    _id: 'playlist-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-04-14T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    isFullStalkerPortal: false,
} as PlaylistMeta;

interface SelectedTestItem {
    id: string;
    cmd: string;
    has_files?: boolean;
    title?: string;
    name?: string;
    o_name?: string;
    logo?: string;
    category_id?: string;
    cover?: string;
    use_http_tmp_link?: unknown;
    use_load_balancing?: unknown;
}

const TestPlayerStore = signalStore(
    withState({
        currentPlaylist: PLAYLIST,
        selectedContentType: 'vod' as 'vod' | 'series' | 'itv' | 'radio',
        selectedItem: {
            id: '22',
            cmd: '/media/source_22.mpg',
            has_files: true,
            title: 'Original Title',
            category_id: 'vod',
        } as SelectedTestItem,
    }),
    withMethods((store) => ({
        setSelectedContentType(type: 'vod' | 'series' | 'itv' | 'radio') {
            patchState(store, { selectedContentType: type });
        },
        setSelectedItem(item: SelectedTestItem) {
            patchState(store, { selectedItem: item });
        },
    })),
    withStalkerPlayer()
);

describe('withStalkerPlayer', () => {
    let store: InstanceType<typeof TestPlayerStore>;
    let dataService: {
        sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>;
    };
    let playlistService: {
        addPortalRecentlyViewed: jest.Mock;
    };
    let ngrxStore: {
        dispatch: jest.Mock;
    };

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        playlistService = {
            addPortalRecentlyViewed: jest.fn(() =>
                of({ recentlyViewed: [{ id: '22', title: 'Movie Title' }] })
            ),
        };
        ngrxStore = {
            dispatch: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                TestPlayerStore,
                { provide: DataService, useValue: dataService },
                {
                    provide: PlaylistsService,
                    useValue: playlistService,
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        openResolvedPlayback: jest.fn(),
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        getCachedToken: jest.fn(),
                        makeAuthenticatedRequest: jest.fn(),
                        ensureToken: jest.fn().mockResolvedValue({
                            token: null,
                        }),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
                {
                    provide: Store,
                    useValue: ngrxStore,
                },
            ],
        });

        store = TestBed.inject(TestPlayerStore);
    });

    it('falls back to file ids for VOD playback and persists recently viewed metadata', async () => {
        dataService.sendIpcEvent
            .mockResolvedValueOnce({
                js: {
                    data: [{ id: 77 }],
                },
            })
            .mockResolvedValueOnce({
                js: {
                    cmd: 'ffmpeg http://cdn.example/video_77.mpg',
                },
            });

        const playback = await store.resolveVodPlayback(
            undefined,
            'Movie Title',
            'thumb.jpg'
        );

        expect(dataService.sendIpcEvent).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'vod',
                    movie_id: '22',
                    p: '1',
                }),
            })
        );
        expect(dataService.sendIpcEvent).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.CreateLink,
                    cmd: '/media/file_77.mpg',
                    type: 'vod',
                }),
            })
        );
        expect(playlistService.addPortalRecentlyViewed).toHaveBeenCalledWith(
            PLAYLIST._id,
            expect.objectContaining({
                id: '22',
                title: 'Movie Title',
                category_id: 'vod',
                cover: 'thumb.jpg',
                added_at: expect.any(Number),
            })
        );
        expect(ngrxStore.dispatch).toHaveBeenCalled();
        expect(playback.streamUrl).toBe('http://cdn.example/video_77.mpg');
        expect(playback.contentInfo).toEqual({
            playlistId: PLAYLIST._id,
            contentXtreamId: 22,
            contentType: 'vod',
            seriesXtreamId: undefined,
        });
    });

    it('persists regular series recent metadata without marking it as a VOD series', async () => {
        store.setSelectedContentType('series');
        store.setSelectedItem({
            id: '30000',
            cmd: '',
            title: 'Regular Series',
            category_id: 'series',
        });
        dataService.sendIpcEvent.mockResolvedValueOnce({
            js: {
                cmd: 'ffmpeg http://cdn.example/episode_30000_1.mpg',
            },
        });

        const playback = await store.resolveVodPlayback(
            'ffrt4://series/30000/season/1',
            'Episode One',
            'series.jpg',
            1,
            3000001
        );

        expect(playlistService.addPortalRecentlyViewed).toHaveBeenCalledWith(
            PLAYLIST._id,
            expect.objectContaining({
                id: '30000',
                title: 'Episode One',
                category_id: 'series',
                cover: 'series.jpg',
                added_at: expect.any(Number),
            })
        );
        expect(
            playlistService.addPortalRecentlyViewed.mock.calls[0][1]
        ).not.toHaveProperty('is_series');
        expect(playback.contentInfo).toEqual({
            playlistId: PLAYLIST._id,
            contentXtreamId: 3000001,
            contentType: 'episode',
            seriesXtreamId: 30000,
        });
    });

    it('resolves direct radio stream commands without external player side effects', async () => {
        store.setSelectedContentType('radio');
        store.setSelectedItem({
            id: 'radio-1',
            cmd: 'ifm https://stream.example/jazz.mp3',
            name: 'Jazz FM',
            o_name: 'Jazz FM',
            logo: 'jazz.png',
            category_id: '4001',
        });

        const playback = await store.resolveRadioPlayback({
            id: 'radio-1',
            cmd: 'ifm https://stream.example/jazz.mp3',
            name: 'Jazz FM',
            o_name: 'Jazz FM',
            logo: 'jazz.png',
            category_id: '4001',
        });

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(playlistService.addPortalRecentlyViewed).toHaveBeenCalledWith(
            PLAYLIST._id,
            expect.objectContaining({
                id: 'radio-1',
                title: 'Jazz FM',
                category_id: '4001',
                cover: 'jazz.png',
                added_at: expect.any(Number),
            })
        );
        expect(playback).toEqual(
            expect.objectContaining({
                streamUrl: 'https://stream.example/jazz.mp3',
                title: 'Jazz FM',
                thumbnail: 'jazz.png',
            })
        );
    });

    it('attaches the portal header set to VOD playback on the portal host', async () => {
        const session = TestBed.inject(StalkerSessionService) as unknown as {
            getCachedToken: jest.Mock;
        };
        session.getCachedToken.mockReturnValue('TOKEN99');
        // Same host as the portal, different port — the #1158-class stream
        // shape that is gated on the portal cookie.
        dataService.sendIpcEvent
            .mockResolvedValueOnce({ js: { data: [{ id: 77 }] } })
            .mockResolvedValueOnce({
                js: { cmd: 'ffmpeg http://demo.example:8080/video_77.mpg' },
            });

        const playback = await store.resolveVodPlayback(
            undefined,
            'Movie Title',
            'thumb.jpg'
        );

        expect(session.getCachedToken).toHaveBeenCalledWith(PLAYLIST._id);
        expect(playback.headers?.['Cookie']).toContain('mac=00:1A:79:00:00:01');
        expect(playback.headers?.['Authorization']).toBe('Bearer TOKEN99');
        expect(playback.headers?.['X-User-Agent']).toBeDefined();
        expect(playback.userAgent).toBe(playback.headers?.['User-Agent']);
        expect(playback.referer).toBe('http://demo.example');
        expect(playback.origin).toBe('http://demo.example');
    });

    it('keeps VOD playback from a foreign CDN credential-free', async () => {
        const session = TestBed.inject(StalkerSessionService) as unknown as {
            getCachedToken: jest.Mock;
        };
        session.getCachedToken.mockReturnValue('TOKEN99');
        dataService.sendIpcEvent
            .mockResolvedValueOnce({ js: { data: [{ id: 77 }] } })
            .mockResolvedValueOnce({
                js: { cmd: 'ffmpeg http://cdn.example/video_77.mpg' },
            });

        const playback = await store.resolveVodPlayback(
            undefined,
            'Movie Title',
            'thumb.jpg'
        );

        expect(playback.headers?.['Cookie']).toBeUndefined();
        expect(playback.headers?.['Authorization']).toBeUndefined();
        expect(playback.headers?.['User-Agent']).toBe('KSPlayer');
        expect(playback.referer).toBeUndefined();
        expect(playback.origin).toBeUndefined();
    });

    it('resumes a CDN episode without fixing subsequent media requests at byte zero', async () => {
        dataService.sendIpcEvent.mockResolvedValueOnce({
            js: { cmd: 'ffmpeg http://cdn.example/episode_3.mkv' },
        });

        const playback = await store.resolveVodPlayback(
            'ffmpeg http://cdn.example/episode_3.mkv',
            'Episode 3',
            undefined,
            3,
            123,
            780
        );

        expect(playback.startTime).toBe(780);
        expect(playback.contentInfo).toMatchObject({
            contentType: 'episode',
            contentXtreamId: 123,
        });
        expect(playback.headers?.['User-Agent']).toBe('KSPlayer');
        expect(playback.headers).not.toHaveProperty('Range');
    });

    describe('temporary-link semantics', () => {
        const CHANNEL = {
            id: '10001',
            cmd: 'ffrt3 http://cdn.example/live/10001.m3u8',
            name: 'Static TV',
            o_name: 'Static TV',
            logo: 'static-tv.png',
            category_id: '1001',
        };

        it('plays an unflagged ITV channel straight from its static cmd', async () => {
            store.setSelectedContentType('itv');

            const playback = await store.resolveItvPlayback({
                ...CHANNEL,
                use_http_tmp_link: '0',
                use_load_balancing: '0',
            });

            expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
            expect(playback.streamUrl).toBe(
                'http://cdn.example/live/10001.m3u8'
            );
            expect(playback.isLive).toBe(true);
        });

        it.each(['use_http_tmp_link', 'use_load_balancing'] as const)(
            'mints a temporary link for an ITV channel with %s set',
            async (flag) => {
                store.setSelectedContentType('itv');
                dataService.sendIpcEvent.mockResolvedValueOnce({
                    js: { cmd: 'ffmpeg http://cdn.example/tmp/10001.m3u8' },
                });

                const playback = await store.resolveItvPlayback({
                    ...CHANNEL,
                    [flag]: '1',
                });

                expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
                    expect.anything(),
                    expect.objectContaining({
                        params: expect.objectContaining({
                            action: StalkerPortalActions.CreateLink,
                            cmd: CHANNEL.cmd,
                            type: 'itv',
                        }),
                    })
                );
                expect(playback.streamUrl).toBe(
                    'http://cdn.example/tmp/10001.m3u8'
                );
            }
        );

        it('mints a temporary link for a flagged radio station with a playable cmd', async () => {
            // Before the flags were read, a directly playable radio command
            // always bypassed create_link — a proxied station then played a
            // URL the portal never intended to serve.
            store.setSelectedContentType('radio');
            dataService.sendIpcEvent.mockResolvedValueOnce({
                js: { cmd: 'http://cdn.example/tmp/jazz.mp3' },
            });

            const playback = await store.resolveRadioPlayback({
                id: 'radio-3',
                cmd: 'ifm https://stream.example/jazz.mp3',
                name: 'Jazz FM',
                o_name: 'Jazz FM',
                logo: 'jazz.png',
                category_id: '4001',
                use_http_tmp_link: '1',
            });

            expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    params: expect.objectContaining({
                        action: StalkerPortalActions.CreateLink,
                        type: 'radio',
                    }),
                })
            );
            expect(playback.streamUrl).toBe('http://cdn.example/tmp/jazz.mp3');
        });

        it('mints a link for a flagged VOD row with a directly playable cmd', async () => {
            // The VOD row reaches this method through
            // `buildStalkerSelectedVodItem`, a whitelist — if it ever drops
            // the flags again, this row reads as unflagged and the static
            // path silently plays the portal's non-final URL.
            store.setSelectedContentType('vod');
            store.setSelectedItem({
                id: '42',
                cmd: 'ffrt3 http://cdn.example/movie.mkv',
                title: 'Flagged Movie',
                category_id: 'vod',
                use_http_tmp_link: '1',
            });
            dataService.sendIpcEvent.mockResolvedValueOnce({
                js: { cmd: 'http://cdn.example/tmp/movie.mkv?tok=1' },
            });

            const playback = await store.resolveVodPlayback(
                undefined,
                'Flagged Movie'
            );

            expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    params: expect.objectContaining({
                        action: StalkerPortalActions.CreateLink,
                    }),
                })
            );
            expect(playback.streamUrl).toBe(
                'http://cdn.example/tmp/movie.mkv?tok=1'
            );
        });

        it('plays an unflagged VOD row from its static cmd', async () => {
            store.setSelectedContentType('vod');
            store.setSelectedItem({
                id: '43',
                cmd: 'ffrt3 http://cdn.example/movie.mkv',
                title: 'Static Movie',
                category_id: 'vod',
                use_http_tmp_link: '0',
                use_load_balancing: '0',
            });

            const playback = await store.resolveVodPlayback(
                undefined,
                'Static Movie'
            );

            expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
            expect(playback.streamUrl).toBe('http://cdn.example/movie.mkv');
        });

        it.each([
            ['static', { use_http_tmp_link: '0' }, undefined],
            [
                'minted',
                { use_http_tmp_link: '1' },
                { js: { cmd: 'http://cdn.example/tmp/10001.m3u8?tok=SECRET' } },
            ],
        ])(
            'stores the portal cmd, never the %s stream URL, in recently viewed',
            async (_label, flags, response) => {
                // A temporary link dies after ~5 s, so a replayed one is worse
                // than useless — the row has to keep the `cmd` and re-resolve.
                store.setSelectedContentType('itv');
                if (response) {
                    dataService.sendIpcEvent.mockResolvedValueOnce(response);
                }

                await store.resolveItvPlayback({ ...CHANNEL, ...flags });

                expect(
                    playlistService.addPortalRecentlyViewed
                ).toHaveBeenCalledWith(
                    PLAYLIST._id,
                    expect.objectContaining({
                        id: '10001',
                        cmd: CHANNEL.cmd,
                    })
                );
                const [, persisted] =
                    playlistService.addPortalRecentlyViewed.mock.calls[0];
                expect(JSON.stringify(persisted)).not.toContain('SECRET');
                expect(JSON.stringify(persisted)).not.toContain('/tmp/');
            }
        );
    });

    it('attaches the portal header set to radio playback resolved from the portal', async () => {
        const session = TestBed.inject(StalkerSessionService) as unknown as {
            getCachedToken: jest.Mock;
        };
        session.getCachedToken.mockReturnValue('TOKEN99');
        store.setSelectedContentType('radio');
        const radioItem = {
            id: 'radio-2',
            cmd: '/media/radio_2.mpg',
            name: 'Portal FM',
            o_name: 'Portal FM',
            logo: 'portal-fm.png',
            category_id: '4001',
        };
        store.setSelectedItem(radioItem);
        dataService.sendIpcEvent.mockResolvedValueOnce({
            js: { cmd: 'ffmpeg http://demo.example/radio_2.mpg' },
        });

        const playback = await store.resolveRadioPlayback(radioItem);

        expect(playback.headers?.['Cookie']).toContain('mac=00:1A:79:00:00:01');
        expect(playback.headers?.['Authorization']).toBe('Bearer TOKEN99');
        expect(playback.referer).toBe('http://demo.example');
        expect(playback.origin).toBe('http://demo.example');
    });
});
