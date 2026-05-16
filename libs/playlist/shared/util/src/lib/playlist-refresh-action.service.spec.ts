import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { DialogService } from 'components';
import {
    DatabaseService,
    PlaybackPositionService,
    PlaylistRefreshService,
} from 'services';
import { ChannelActions, PlaylistActions } from 'm3u-state';
import { Playlist, PlaylistMeta } from 'shared-interfaces';
import { PlaylistContextFacade } from './playlist-context.facade';
import { PlaylistRefreshActionService } from './playlist-refresh-action.service';
import { SourceVpnPreparationService } from './source-vpn-preparation.service';

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

function createAbortError(): Error {
    const error = new Error('Cancelled');
    error.name = 'AbortError';
    return error;
}

async function waitForRefreshPreparationPaint(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 160));
}

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
        setXtreamImportStatus: jest.Mock;
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
    let playbackPositionService: {
        getAllPlaybackPositions: jest.Mock;
    };
    let sourceVpnPreparation: {
        prepareForPlaylist: jest.Mock;
        shouldPrepareForPlaylist: jest.Mock;
    };
    let routeProvider: ReturnType<
        typeof signal<'playlists' | 'xtreams' | null>
    >;
    let resolvedPlaylistId: ReturnType<typeof signal<string | null>>;

    beforeEach(() => {
        localStorage.clear();

        databaseService = {
            createOperationId: jest.fn((prefix: string) => `${prefix}-op`),
            deleteXtreamPlaylistContent: jest.fn().mockResolvedValue({
                success: true,
                favorites: [
                    {
                        xtreamId: 101,
                        contentType: 'live',
                    },
                    {
                        xtreamId: 202,
                        contentType: 'movie',
                    },
                ],
                recentlyViewed: [
                    {
                        xtreamId: 303,
                        contentType: 'series',
                        viewedAt: '2026-04-04T08:00:00.000Z',
                    },
                ],
                hiddenCategories: [{ xtreamId: 404, categoryType: 'live' }],
            }),
            setXtreamImportStatus: jest.fn().mockResolvedValue(true),
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
        playbackPositionService = {
            getAllPlaybackPositions: jest.fn().mockResolvedValue([]),
        };
        sourceVpnPreparation = {
            prepareForPlaylist: jest.fn().mockResolvedValue(null),
            shouldPrepareForPlaylist: jest.fn().mockReturnValue(false),
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
                    provide: PlaybackPositionService,
                    useValue: playbackPositionService,
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        routeProvider,
                        resolvedPlaylistId,
                    },
                },
                {
                    provide: SourceVpnPreparationService,
                    useValue: sourceVpnPreparation,
                },
            ],
        });

        service = TestBed.inject(PlaylistRefreshActionService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('treats file-backed M3U playlists as refreshable in Electron', () => {
        window.electron = { platform: 'darwin' } as typeof window.electron;

        expect(
            service.canRefresh(
                createPlaylistMeta({
                    serverUrl: undefined,
                    username: undefined,
                    password: undefined,
                    filePath: '/tmp/local-source.m3u',
                })
            )
        ).toBe(true);
    });

    it('does not expose filesystem refresh outside Electron', () => {
        window.electron = undefined as unknown as typeof window.electron;

        expect(
            service.canRefresh(
                createPlaylistMeta({
                    serverUrl: undefined,
                    username: undefined,
                    password: undefined,
                    filePath: '/tmp/local-source.m3u',
                })
            )
        ).toBe(false);
    });

    it('invalidates Xtream import statuses before updating playlist meta and navigating', async () => {
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

        expect(dialogService.openConfirmDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                width: '400px',
            })
        );
        expect(
            databaseService.deleteXtreamPlaylistContent
        ).not.toHaveBeenCalled();
        expect(databaseService.setXtreamImportStatus).toHaveBeenCalledTimes(3);
        expect(databaseService.setXtreamImportStatus).toHaveBeenCalledWith(
            item._id,
            'live',
            'idle'
        );
        expect(databaseService.setXtreamImportStatus).toHaveBeenCalledWith(
            item._id,
            'movie',
            'idle'
        );
        expect(databaseService.setXtreamImportStatus).toHaveBeenCalledWith(
            item._id,
            'series',
            'idle'
        );
        expect(setItemSpy).not.toHaveBeenCalled();
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
        expect(executionOrder).toEqual(['dispatch', 'navigate']);

        setItemSpy.mockRestore();
        dateNowSpy.mockRestore();
    });

    it('sets refresh-preparation state immediately after Xtream refresh confirmation', async () => {
        const item = createPlaylistMeta();
        const refresh = createDeferred<boolean>();
        let confirmPromise: Promise<void> | undefined;

        databaseService.setXtreamImportStatus.mockReturnValue(
            refresh.promise
        );
        dialogService.openConfirmDialog.mockImplementation(
            ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                confirmPromise = onConfirm?.();
            }
        );

        service.refresh(item);

        expect(service.refreshPreparation()).toEqual({
            playlistId: item._id,
            operationId: 'xtream-refresh-op',
            phase: 'invalidating-import-cache',
            current: 0,
            total: 3,
        });

        refresh.resolve(true);
        await confirmPromise;

        expect(service.refreshPreparation()).toBeNull();
    });

    it('updates refresh-preparation progress while invalidating Xtream cache statuses', async () => {
        const item = createPlaylistMeta();
        const refreshes = [
            createDeferred<boolean>(),
            createDeferred<boolean>(),
            createDeferred<boolean>(),
        ];
        let confirmPromise: Promise<void> | undefined;

        databaseService.setXtreamImportStatus.mockImplementation(
            () =>
                refreshes[
                    databaseService.setXtreamImportStatus.mock.calls.length - 1
                ].promise
        );
        dialogService.openConfirmDialog.mockImplementation(
            ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                confirmPromise = onConfirm?.();
            }
        );

        service.refresh(item);
        await waitForRefreshPreparationPaint();

        expect(service.refreshPreparation()).toEqual({
            playlistId: item._id,
            operationId: 'xtream-refresh-op',
            phase: 'invalidating-import-cache',
            current: 0,
            total: 3,
        });

        refreshes[0].resolve(true);
        await Promise.resolve();

        expect(service.refreshPreparation()).toEqual({
            playlistId: item._id,
            operationId: 'xtream-refresh-op',
            phase: 'invalidating-import-cache',
            current: 1,
            total: 3,
        });

        refreshes[1].resolve(true);
        refreshes[2].resolve(true);
        await confirmPromise;
    });

    it.each([
        ['abort', createAbortError()],
        ['error', new Error('Refresh failed')],
    ])(
        'clears refresh-preparation state after Xtream refresh %s',
        async (_caseName, error) => {
            const item = createPlaylistMeta();
            const consoleErrorSpy = jest
                .spyOn(console, 'error')
                .mockImplementation();
            const refresh = createDeferred<boolean>();
            let confirmPromise: Promise<void> | undefined;

            databaseService.setXtreamImportStatus.mockReturnValue(
                refresh.promise
            );
            dialogService.openConfirmDialog.mockImplementation(
                ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                    confirmPromise = onConfirm?.();
                }
            );

            try {
                service.refresh(item);
                expect(service.refreshPreparation()).not.toBeNull();

                refresh.reject(error);
                await confirmPromise;

                expect(service.refreshPreparation()).toBeNull();
            } finally {
                consoleErrorSpy.mockRestore();
            }
        }
    );

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
        playlistRefreshService.refreshPlaylist.mockResolvedValue(
            refreshedPlaylist
        );

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

    it('prepares a source VPN before refreshing an M3U URL source', async () => {
        const item = createPlaylistMeta({
            _id: 'playlist-1',
            serverUrl: undefined,
            username: undefined,
            password: undefined,
            url: 'https://example.com/playlist.m3u',
            vpnProvider: 'proton',
            vpnLocation: 'HR',
            vpnAutoConnectOnOpen: true,
        });
        const vpnPreparation = createDeferred<null>();
        const refreshedPlaylist = {
            _id: item._id,
            playlist: {
                items: [],
            },
        } as Playlist;

        sourceVpnPreparation.shouldPrepareForPlaylist.mockReturnValue(true);
        sourceVpnPreparation.prepareForPlaylist.mockReturnValue(
            vpnPreparation.promise
        );
        playlistRefreshService.refreshPlaylist.mockResolvedValue(
            refreshedPlaylist
        );

        service.refresh(item);
        await Promise.resolve();

        expect(sourceVpnPreparation.prepareForPlaylist).toHaveBeenCalledWith(
            item,
            'source-open'
        );
        expect(playlistRefreshService.refreshPlaylist).not.toHaveBeenCalled();

        vpnPreparation.resolve(null);
        await Promise.resolve();
        await Promise.resolve();

        expect(playlistRefreshService.refreshPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                playlistId: item._id,
                url: item.url,
            })
        );
    });
});
