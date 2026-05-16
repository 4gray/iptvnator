import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    PlaylistActions,
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from 'm3u-state';
import { of } from 'rxjs';
import { DialogService } from 'components';
import {
    DatabaseService,
    DataService,
    PlaybackPositionService,
    SortBy,
    SortOrder,
    SortService,
} from 'services';
import { PLAYLIST_UPDATE, PlaylistMeta } from 'shared-interfaces';
import { RecentPlaylistsComponent } from './recent-playlists.component';

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

function createPlaylistMeta(
    overrides: Partial<PlaylistMeta> = {}
): PlaylistMeta {
    return {
        _id: 'playlist-1',
        title: 'Xtream Playlist',
        count: 0,
        importDate: new Date('2026-03-28T00:00:00.000Z').toISOString(),
        autoRefresh: false,
        serverUrl: 'http://localhost:8080',
        username: 'demo',
        password: 'secret',
        ...overrides,
    } as PlaylistMeta;
}

describe('RecentPlaylistsComponent busy state', () => {
    let component: RecentPlaylistsComponent;
    let databaseService: {
        cancelOperation: jest.Mock;
        createOperationId: jest.Mock;
        deletePlaylist: jest.Mock;
        deleteXtreamPlaylistContent: jest.Mock;
        setXtreamImportStatus: jest.Mock;
        updateXtreamPlaylistDetails: jest.Mock;
    };
    let dialogService: {
        openConfirmDialog: jest.Mock;
    };
    let dataService: {
        sendIpcEvent: jest.Mock;
    };
    let playbackPositionService: {
        getAllPlaybackPositions: jest.Mock;
    };
    let router: {
        navigate: jest.Mock;
    };
    let snackBar: {
        open: jest.Mock;
    };
    let store: MockStore;

    beforeEach(async () => {
        databaseService = {
            cancelOperation: jest.fn().mockResolvedValue(true),
            createOperationId: jest.fn((prefix: string) => `${prefix}-op`),
            deletePlaylist: jest.fn(),
            deleteXtreamPlaylistContent: jest.fn(),
            setXtreamImportStatus: jest.fn().mockResolvedValue(true),
            updateXtreamPlaylistDetails: jest.fn().mockResolvedValue(undefined),
        };
        dialogService = {
            openConfirmDialog: jest.fn(),
        };
        dataService = {
            sendIpcEvent: jest.fn(),
        };
        playbackPositionService = {
            getAllPlaybackPositions: jest.fn().mockResolvedValue([]),
        };
        router = {
            navigate: jest.fn(),
        };
        snackBar = {
            open: jest.fn(),
        };
        await TestBed.configureTestingModule({
            imports: [RecentPlaylistsComponent],
            providers: [
                provideMockStore({
                    selectors: [
                        { selector: selectPlaylistsLoadingFlag, value: true },
                        {
                            selector: selectAllPlaylistsMeta,
                            value: [],
                        },
                        {
                            selector: selectActiveTypeFilters,
                            value: ['xtream', 'm3u', 'stalker'],
                        },
                    ],
                }),
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: DialogService,
                    useValue: dialogService,
                },
                {
                    provide: DataService,
                    useValue: dataService,
                },
                {
                    provide: PlaybackPositionService,
                    useValue: playbackPositionService,
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: {
                        resolvedPlaylistId: signal<string | null>(null),
                    },
                },
                {
                    provide: MatDialog,
                    useValue: {
                        open: jest.fn(),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: Router,
                    useValue: router,
                },
                {
                    provide: SortService,
                    useValue: {
                        getSortOptions: jest.fn(() =>
                            of({
                                by: SortBy.DATE_ADDED,
                                order: SortOrder.DESC,
                            })
                        ),
                        sortPlaylists: jest.fn(
                            (playlists: PlaylistMeta[]) => playlists
                        ),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
            ],
        }).compileComponents();

        component = TestBed.createComponent(
            RecentPlaylistsComponent
        ).componentInstance;
        store = TestBed.inject(MockStore);
        jest.spyOn(store, 'dispatch');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('tracks delete progress and clears the busy row after completion', async () => {
        const item = createPlaylistMeta({ _id: 'playlist-delete-1' });
        const deletion = createDeferred<boolean>();

        databaseService.deletePlaylist.mockImplementation(
            (
                _playlistId: string,
                options?: {
                    onEvent?: (event: any) => void;
                    operationId?: string;
                }
            ) => {
                options?.onEvent?.({
                    operation: 'delete-playlist',
                    operationId: 'playlist-delete-op',
                    status: 'progress',
                    phase: 'deleting-content',
                    current: 25,
                    total: 100,
                });
                return deletion.promise;
            }
        );

        const removalPromise = component.removePlaylist(item);

        expect(component.isDeletePending(item._id)).toBe(true);
        expect(component.getBusyMessage(item)).toBe(
            'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_CONTENT'
        );
        expect(component.getBusyProgress(item._id)).toBe(25);
        expect(component.canCancelBusyOperation(item)).toBe(true);

        await component.cancelBusyOperation(item);
        expect(databaseService.cancelOperation).toHaveBeenCalledWith(
            'playlist-delete-op'
        );

        deletion.resolve(true);
        await removalPromise;

        expect(component.isDeletePending(item._id)).toBe(false);
        expect(component.getBusyProgress(item._id)).toBeNull();
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.removePlaylist({ playlistId: item._id })
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.REMOVE_DIALOG.SUCCESS',
            undefined,
            { duration: 2000 }
        );
    });

    it('tracks Xtream refresh progress and clears the busy row after abort', async () => {
        const item = createPlaylistMeta({ _id: 'playlist-refresh-1' });
        const refresh = createDeferred<boolean>();
        let confirmPromise: Promise<void> | undefined;

        dialogService.openConfirmDialog.mockImplementation(
            ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                confirmPromise = onConfirm?.();
            }
        );

        databaseService.setXtreamImportStatus.mockImplementation(
            () => refresh.promise
        );

        component.refreshXtreamPlaylist(item);
        await Promise.resolve();

        expect(component.isRefreshPending(item._id)).toBe(true);
        expect(component.getBusyMessage(item)).toBe(
            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.IN_PROGRESS'
        );
        expect(component.getBusyProgress(item._id)).toBe(0);
        expect(component.canCancelBusyOperation(item)).toBe(true);

        await component.cancelBusyOperation(item);
        expect(databaseService.cancelOperation).toHaveBeenCalledWith(
            'xtream-refresh-op'
        );

        refresh.reject(createAbortError());
        await confirmPromise;

        expect(component.isRefreshPending(item._id)).toBe(false);
        expect(component.getBusyProgress(item._id)).toBeNull();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('dispatches playlist meta with updateDate after Xtream refresh setup succeeds', async () => {
        const item = createPlaylistMeta({ _id: 'playlist-refresh-success-1' });
        let confirmPromise: Promise<void> | undefined;
        const executionOrder: string[] = [];
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(1712145600000);
        const originalSetItem = Storage.prototype.setItem;
        const setItemSpy = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (key: string, value: string) {
                executionOrder.push('setItem');
                return originalSetItem.call(this, key, value);
            });

        dialogService.openConfirmDialog.mockImplementation(
            ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                confirmPromise = onConfirm?.();
            }
        );
        (store.dispatch as jest.Mock).mockImplementation((action: unknown) => {
            executionOrder.push('dispatch');
            return action;
        });
        router.navigate.mockImplementation((commands: unknown[]) => {
            executionOrder.push('navigate');
            return Promise.resolve(Boolean(commands));
        });
        component.refreshXtreamPlaylist(item);
        await confirmPromise;

        expect(dialogService.openConfirmDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                width: '400px',
            })
        );
        expect(
            databaseService.updateXtreamPlaylistDetails
        ).toHaveBeenCalledWith({
            id: item._id,
            updateDate: 1712145600000,
        });
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
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({
                playlist: { ...item, updateDate: 1712145600000 },
            })
        );
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            item._id,
        ]);
        expect(executionOrder).toEqual(['dispatch', 'navigate']);

        setItemSpy.mockRestore();
        dateNowSpy.mockRestore();
    });

    it('uses the legacy IPC refresh flow for non-Xtream playlists', () => {
        const item = createPlaylistMeta({
            _id: 'playlist-m3u-1',
            serverUrl: undefined,
            username: undefined,
            password: undefined,
            filePath: '/tmp/test.m3u',
        });

        component.refreshPlaylist(item);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(PLAYLIST_UPDATE, {
            id: item._id,
            title: item.title,
            filePath: item.filePath,
        });
    });
});
