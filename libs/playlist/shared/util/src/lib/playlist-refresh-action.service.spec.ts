import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { DialogService } from 'components';
import { DatabaseService, PlaylistRefreshService } from 'services';
import { ChannelActions, PlaylistActions } from 'm3u-state';
import { Playlist, PlaylistMeta } from 'shared-interfaces';
import { PlaylistContextFacade } from './playlist-context.facade';
import { PlaylistRefreshActionService } from './playlist-refresh-action.service';

function createPlaylistMeta(
    overrides: Partial<PlaylistMeta> = {}
): PlaylistMeta {
    return {
        _id: 'playlist-1',
        title: 'Xtream Playlist',
        serverUrl: 'http://localhost:8080',
        username: 'demo',
        password: 'secret',
        ...overrides,
    } as PlaylistMeta;
}

describe('PlaylistRefreshActionService', () => {
    let service: PlaylistRefreshActionService;
    let databaseService: {
        createOperationId: jest.Mock;
        deleteXtreamPlaylistContent: jest.Mock;
        updateXtreamPlaylistDetails: jest.Mock;
    };
    let dialogService: {
        openConfirmDialog: jest.Mock;
    };
    let router: {
        navigate: jest.Mock;
    };
    let snackBar: {
        open: jest.Mock;
    };
    let store: {
        dispatch: jest.Mock;
    };
    let playlistRefreshService: {
        refreshPlaylist: jest.Mock;
    };
    let routeProvider: ReturnType<typeof signal<'playlists' | 'xtreams' | null>>;
    let resolvedPlaylistId: ReturnType<typeof signal<string | null>>;

    beforeEach(() => {
        localStorage.clear();

        databaseService = {
            createOperationId: jest.fn((prefix: string) => `${prefix}-op`),
            deleteXtreamPlaylistContent: jest.fn().mockResolvedValue({
                success: true,
                favoritedXtreamIds: [101, 202],
                recentlyViewedXtreamIds: [
                    {
                        xtreamId: 303,
                        viewedAt: '2026-04-04T08:00:00.000Z',
                    },
                ],
                hiddenCategories: [{ xtreamId: 404, type: 'live' }],
            }),
            updateXtreamPlaylistDetails: jest.fn().mockResolvedValue(true),
        };
        dialogService = {
            openConfirmDialog: jest.fn(),
        };
        router = {
            navigate: jest.fn().mockResolvedValue(true),
        };
        snackBar = {
            open: jest.fn(),
        };
        store = {
            dispatch: jest.fn(),
        };
        playlistRefreshService = {
            refreshPlaylist: jest.fn(),
        };
        routeProvider = signal<'playlists' | 'xtreams' | null>('xtreams');
        resolvedPlaylistId = signal<string | null>(null);

        TestBed.configureTestingModule({
            providers: [
                PlaylistRefreshActionService,
                {
                    provide: Router,
                    useValue: router,
                },
                {
                    provide: Store,
                    useValue: store,
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: DialogService,
                    useValue: dialogService,
                },
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: PlaylistRefreshService,
                    useValue: playlistRefreshService,
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        routeProvider,
                        resolvedPlaylistId,
                    },
                },
            ],
        });

        service = TestBed.inject(PlaylistRefreshActionService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('stores Xtream restore data before updating playlist meta and navigating', async () => {
        const item = createPlaylistMeta();
        const executionOrder: string[] = [];
        let confirmPromise: Promise<void> | undefined;
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(1712217600000);
        const originalSetItem = Storage.prototype.setItem;
        const setItemSpy = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (key: string, value: string) {
                executionOrder.push('setItem');
                return originalSetItem.call(this, key, value);
            });

        store.dispatch.mockImplementation((action: unknown) => {
            executionOrder.push('dispatch');
            return action;
        });
        router.navigate.mockImplementation((commands: unknown[]) => {
            executionOrder.push('navigate');
            return Promise.resolve(Boolean(commands));
        });
        dialogService.openConfirmDialog.mockImplementation(
            ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                confirmPromise = onConfirm?.();
            }
        );

        service.refresh(item);
        await confirmPromise;

        expect(setItemSpy).toHaveBeenCalledWith(
            `xtream-restore-${item._id}`,
            JSON.stringify({
                favoritedXtreamIds: [101, 202],
                recentlyViewedXtreamIds: [
                    {
                        xtreamId: 303,
                        viewedAt: '2026-04-04T08:00:00.000Z',
                    },
                ],
                hiddenCategories: [{ xtreamId: 404, type: 'live' }],
            })
        );
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({
                playlist: { ...item, updateDate: 1712217600000 },
            })
        );
        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            item._id,
        ]);
        expect(executionOrder).toEqual(['setItem', 'dispatch', 'navigate']);

        setItemSpy.mockRestore();
        dateNowSpy.mockRestore();
    });

    it('marks the active M3U route as loading before refreshing and clears loading after the update action', async () => {
        const item = createPlaylistMeta({
            _id: 'playlist-1',
            filePath: '/tmp/playlist.m3u',
            serverUrl: undefined,
            url: 'https://example.com/playlist.m3u',
        });
        const refreshedPlaylist = {
            _id: item._id,
            playlist: {
                items: [],
            },
        } as Playlist;
        routeProvider.set('playlists');
        resolvedPlaylistId.set(item._id);
        playlistRefreshService.refreshPlaylist.mockResolvedValue(refreshedPlaylist);

        service.refresh(item);
        await Promise.resolve();
        await Promise.resolve();

        expect(store.dispatch).toHaveBeenNthCalledWith(
            1,
            ChannelActions.setChannelsLoading({ loading: true })
        );
        expect(store.dispatch).toHaveBeenNthCalledWith(
            2,
            PlaylistActions.updatePlaylist({
                playlist: refreshedPlaylist,
                playlistId: item._id,
            })
        );
    });
});
