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
    STALKER_SESSION_APPLICATION_OPERATIONS,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { STALKER_RECIPE_CLASSIFIER_VERSION } from '@iptvnator/portal/stalker/protocol';
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
        } as {
            id: string;
            cmd: string;
            has_files?: boolean;
            title?: string;
            name?: string;
            o_name?: string;
            logo?: string;
            category_id?: string;
            cover?: string;
        },
    }),
    withMethods((store) => ({
        setCurrentPlaylist(playlist: PlaylistMeta) {
            patchState(store, { currentPlaylist: playlist });
        },
        setSelectedContentType(type: 'vod' | 'series' | 'itv' | 'radio') {
            patchState(store, { selectedContentType: type });
        },
        setSelectedItem(item: {
            id: string;
            cmd: string;
            title?: string;
            name?: string;
            o_name?: string;
            logo?: string;
            category_id?: string;
        }) {
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
    let stalkerSession: {
        supportsTypedSessions: jest.Mock;
        getLeaseRef: jest.Mock;
        open: jest.Mock;
        request: jest.Mock;
        requestForPlaylist: jest.Mock;
        makeAuthenticatedRequest: jest.Mock;
        getCachedToken: jest.Mock;
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
        stalkerSession = {
            supportsTypedSessions: jest.fn().mockReturnValue(true),
            getLeaseRef: jest.fn(),
            open: jest.fn(),
            request: jest.fn(),
            requestForPlaylist: jest.fn(),
            makeAuthenticatedRequest: jest.fn(),
            getCachedToken: jest.fn(),
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
                    useValue: stalkerSession,
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

    it('uses an opaque playback context for full-portal ITV without renderer auth headers', async () => {
        store.setCurrentPlaylist({
            ...PLAYLIST,
            isFullStalkerPortal: true,
            stalkerRecipeClassifierVersion: STALKER_RECIPE_CLASSIFIER_VERSION,
            stalkerRequestRecipe: 'full-session',
            userAgent: 'renderer-user-agent',
            referrer: 'https://portal.example/referrer',
            origin: 'https://portal.example',
        });
        store.setSelectedContentType('itv');
        stalkerSession.requestForPlaylist.mockResolvedValue({
            streamUrl: 'https://cdn.example/live.m3u8',
            playbackContextRef: 'opaque-playback-context',
        });

        const playback = await store.resolveItvPlayback({
            id: 'itv-1',
            cmd: 'ffmpeg http://portal.example/live/1',
            name: 'Full Portal Live',
        });

        expect(stalkerSession.requestForPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: PLAYLIST._id,
                isFullStalkerPortal: true,
                lastUsage: '',
            }),
            STALKER_SESSION_APPLICATION_OPERATIONS.CreateLink,
            {
                command: 'ffmpeg http://portal.example/live/1',
                contentType: 'itv',
            }
        );
        expect(stalkerSession.request).not.toHaveBeenCalled();
        expect(stalkerSession.getCachedToken).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(playback).toEqual(
            expect.objectContaining({
                streamUrl: 'https://cdn.example/live.m3u8',
                playbackContextRef: 'opaque-playback-context',
                title: 'Full Portal Live',
                isLive: true,
            })
        );
        expect(playback).not.toHaveProperty('headers');
        expect(playback).not.toHaveProperty('userAgent');
        expect(playback).not.toHaveProperty('referer');
        expect(playback).not.toHaveProperty('origin');
    });
});
