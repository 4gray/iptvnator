import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signalStore, withState } from '@ngrx/signals';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { DataService, PlaylistsService } from 'services';
import { of } from 'rxjs';
import { PlaylistMeta, StalkerPortalActions } from 'shared-interfaces';
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
        selectedContentType: 'vod' as 'vod' | 'series' | 'itv',
        selectedItem: {
            id: '22',
            cmd: '/media/source_22.mpg',
            has_files: true,
            title: 'Original Title',
            category_id: 'vod',
        },
    }),
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
});
