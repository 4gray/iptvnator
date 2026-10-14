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
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { of } from 'rxjs';
import { DialogService } from '@iptvnator/ui/components';
import {
    DatabaseService,
    DataService,
    DbOperationEvent,
    PlaybackPositionService,
    PlaylistDeleteActionService,
    PlaylistRefreshService,
    RuntimeCapabilitiesService,
    SortBy,
    SortOrder,
    SortService,
    SourceActivityService,
} from '@iptvnator/services';
import {
    CONNECTIVITY_GUARD_RESET,
    PLAYLIST_UPDATE,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
} from '@iptvnator/shared/logging';
import { SourceListRefreshService } from './source-list-refresh.service';

const performanceHookSymbol = Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY);

function setPerformanceHook(
    hook: ((event: RendererPerformancePhaseEvent) => void) | null
): void {
    const target = globalThis as unknown as Record<symbol, unknown>;
    if (hook === null) {
        delete target[performanceHookSymbol];
    } else {
        target[performanceHookSymbol] = hook;
    }
}

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

describe('SourceListRefreshService', () => {
    let component: SourceListRefreshService;
    let databaseService: {
        cancelOperation: jest.Mock;
        createOperationId: jest.Mock;
        deletePlaylist: jest.Mock;
        deleteXtreamPlaylistContent: jest.Mock;
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
    let playlistDeleteAction: {
        deletePlaylist: jest.Mock;
    };
    let playlistRefreshService: {
        cancelRefresh: jest.Mock;
        refreshPlaylist: jest.Mock;
    };
    let runtime: {
        isElectron: boolean;
        supportsPlaylistRefresh: boolean;
        supportsXtreamSqliteDataSource: boolean;
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
        playlistDeleteAction = {
            deletePlaylist: jest.fn().mockResolvedValue(true),
        };
        playlistRefreshService = {
            cancelRefresh: jest.fn().mockResolvedValue(undefined),
            refreshPlaylist: jest.fn().mockResolvedValue({
                id: 'playlist-1',
                items: [],
            }),
        };
        runtime = {
            isElectron: true,
            supportsPlaylistRefresh: true,
            supportsXtreamSqliteDataSource: true,
        };
        router = {
            navigate: jest.fn(),
        };
        snackBar = {
            open: jest.fn(),
        };
        await TestBed.configureTestingModule({
            providers: [
                SourceListRefreshService,
                provideMockStore({
                    selectors: [
                        { selector: selectPlaylistsLoadingFlag, value: true },
                        {
                            selector: selectAllPlaylistsMeta,
                            value: [],
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
                    provide: PlaylistDeleteActionService,
                    useValue: playlistDeleteAction,
                },
                {
                    provide: PlaylistRefreshService,
                    useValue: playlistRefreshService,
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
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

        component = TestBed.inject(SourceListRefreshService);
        store = TestBed.inject(MockStore);
        jest.spyOn(store, 'dispatch');
    });

    afterEach(() => {
        setPerformanceHook(null);
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('tracks Xtream refresh progress and clears the busy row after abort', async () => {
        const item = createPlaylistMeta({ _id: 'playlist-refresh-1' });
        const refresh = createDeferred<{
            success: boolean;
            favorites: Array<{ xtreamId: number; contentType: string }>;
            recentlyViewed: Array<{
                xtreamId: number;
                contentType: string;
                viewedAt: string;
            }>;
            hiddenCategories: Array<{
                xtreamId: number;
                categoryType: string;
            }>;
        }>();
        let confirmPromise: Promise<void> | undefined;
        // The shared flow awaits the connectivity-guard reset before it starts
        // deleting, so the delete is several ticks away and counting them is
        // fragile. The mock fires onEvent synchronously and the component
        // applies it synchronously, so resolving this deferred inside the mock
        // is a deterministic "the busy row has been updated" signal.
        const workerEventDelivered = createDeferred<void>();

        dialogService.openConfirmDialog.mockImplementation(
            ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                confirmPromise = onConfirm?.();
            }
        );

        databaseService.deleteXtreamPlaylistContent.mockImplementation(
            (
                _playlistId: string,
                options?: {
                    onEvent?: (event: DbOperationEvent) => void;
                    operationId?: string;
                }
            ) => {
                options?.onEvent?.({
                    operation: 'delete-xtream-content',
                    operationId: 'xtream-refresh-op',
                    status: 'progress',
                    phase: 'collecting-user-data',
                    current: 1,
                    total: 4,
                });
                workerEventDelivered.resolve();

                return refresh.promise;
            }
        );

        component.refresh(item);
        await workerEventDelivered.promise;

        expect(component.isRefreshing(item._id)).toBe(true);
        expect(component.message(item)).toBe(
            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.COLLECTING_DATA'
        );
        expect(component.progress(item._id)).toBe(25);
        expect(component.canCancel(item)).toBe(true);

        await component.cancel(item);
        expect(databaseService.cancelOperation).toHaveBeenCalledWith(
            'xtream-refresh-op'
        );

        refresh.reject(createAbortError());
        await confirmPromise;

        expect(component.isRefreshing(item._id)).toBe(false);
        expect(component.progress(item._id)).toBeNull();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('dispatches playlist meta with updateDate after Xtream refresh setup succeeds', async () => {
        const item = createPlaylistMeta({ _id: 'playlist-refresh-success-1' });
        let confirmPromise: Promise<void> | undefined;
        const executionOrder: string[] = [];
        const performanceEvents: RendererPerformancePhaseEvent[] = [];
        setPerformanceHook((event) => {
            performanceEvents.push(event);
            executionOrder.push(event.boundary);
        });
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(1712145600000);
        const originalSetItem = Storage.prototype.setItem;
        const setItemSpy = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(function (
                this: Storage,
                key: string,
                value: string
            ) {
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
        databaseService.deleteXtreamPlaylistContent.mockResolvedValue({
            success: true,
            favorites: [
                { xtreamId: 101, contentType: 'live' },
                { xtreamId: 202, contentType: 'movie' },
            ],
            recentlyViewed: [
                {
                    xtreamId: 303,
                    contentType: 'series',
                    viewedAt: '2026-04-03T11:15:00.000Z',
                },
            ],
            hiddenCategories: [{ xtreamId: 404, categoryType: 'live' }],
        });

        component.refresh(item);
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
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylistMeta({
                playlist: { ...item, updateDate: 1712145600000 },
            })
        );
        expect(setItemSpy).toHaveBeenCalledWith(
            `xtream-restore-${item._id}`,
            expect.any(String)
        );
        const persistedRestoreState = JSON.parse(
            setItemSpy.mock.calls.find(
                ([key]) => key === `xtream-restore-${item._id}`
            )?.[1] ?? 'null'
        );
        expect(persistedRestoreState).toEqual({
            hiddenCategories: [{ xtreamId: 404, categoryType: 'live' }],
            favorites: [
                { xtreamId: 101, contentType: 'live' },
                { xtreamId: 202, contentType: 'movie' },
            ],
            recentlyViewed: [
                {
                    xtreamId: 303,
                    contentType: 'series',
                    viewedAt: '2026-04-03T11:15:00.000Z',
                },
            ],
            playbackPositions: [],
        });
        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            item._id,
        ]);
        expect(executionOrder).toEqual([
            'setItem',
            'start',
            'dispatch',
            'end',
            'navigate',
        ]);
        expect(performanceEvents).toHaveLength(2);
        expect(performanceEvents[0]?.phaseId).toBe(
            performanceEvents[1]?.phaseId
        );
        expect(
            performanceEvents.map(({ boundary, metadata, outcome, phase }) => ({
                boundary,
                metadata,
                outcome,
                phase,
            }))
        ).toEqual([
            {
                boundary: 'start',
                metadata: { items: 1 },
                outcome: undefined,
                phase: 'store.xtream-refresh-meta',
            },
            {
                boundary: 'end',
                metadata: { items: 1 },
                outcome: 'success',
                phase: 'store.xtream-refresh-meta',
            },
        ]);

        setItemSpy.mockRestore();
        dateNowSpy.mockRestore();
    });

    it('uses the legacy IPC refresh flow for non-Xtream playlists', async () => {
        runtime.supportsPlaylistRefresh = false;
        let answer!: () => void;
        dataService.sendIpcEvent.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                answer = resolve;
            })
        );
        const activity = TestBed.inject(SourceActivityService);
        const item = createPlaylistMeta({
            _id: 'playlist-m3u-1',
            serverUrl: undefined,
            username: undefined,
            password: undefined,
            filePath: undefined,
            url: 'https://example.com/test.m3u',
            userAgent: 'IPTVnator-Test/1.0',
        });

        component.refresh(item);

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(PLAYLIST_UPDATE, {
            id: item._id,
            title: item.title,
            url: item.url,
            userAgent: item.userAgent,
        });
        // Busy, and held for removal and other refreshes, until it answers.
        expect(component.isRefreshing(item._id)).toBe(true);
        expect(activity.isBusy(item._id)).toBe(true);
        component.refresh(item);
        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(1);

        answer();
        await Promise.resolve();
        await Promise.resolve();
        expect(component.isRefreshing(item._id)).toBe(false);
        expect(activity.isBusy(item._id)).toBe(false);
    });

    it('does not use legacy IPC refresh for file-backed playlists without the refresh bridge', () => {
        runtime.supportsPlaylistRefresh = false;
        const item = createPlaylistMeta({
            _id: 'playlist-m3u-1',
            serverUrl: undefined,
            username: undefined,
            password: undefined,
            filePath: '/tmp/test.m3u',
        });

        component.refresh(item);

        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        expect(playlistRefreshService.refreshPlaylist).not.toHaveBeenCalled();
    });

    it('holds a row refresh in the shared registry, and leaves a held source alone', async () => {
        const activity = TestBed.inject(SourceActivityService);
        const item = createPlaylistMeta({
            _id: 'playlist-m3u',
            serverUrl: undefined,
            username: undefined,
            password: undefined,
            url: 'https://source.test/list.m3u',
        });
        let resolve!: (value: unknown) => void;
        playlistRefreshService.refreshPlaylist.mockReturnValueOnce(
            new Promise((r) => {
                resolve = r;
            })
        );
        component.refresh(item);
        // The switcher and the removal guard see the row's refresh.
        expect(activity.isBusy(item._id)).toBe(true);
        resolve({ id: item._id, items: [] });
        await Promise.resolve();
        await Promise.resolve();
        expect(activity.isBusy(item._id)).toBe(false);

        // A refresh or delete started elsewhere holds it: no second run.
        const release = activity.begin([item._id]);
        component.refresh(item);
        expect(playlistRefreshService.refreshPlaylist).toHaveBeenCalledTimes(1);
        release();
    });

    it('re-evaluates refresh bridge availability when refreshing local M3U playlists', async () => {
        runtime.supportsPlaylistRefresh = false;
        const lateComponent = TestBed.inject(SourceListRefreshService);
        runtime.supportsPlaylistRefresh = true;
        const item = createPlaylistMeta({
            _id: 'playlist-m3u-2',
            serverUrl: undefined,
            username: undefined,
            password: undefined,
            filePath: '/tmp/test.m3u',
            userAgent: 'IPTVnator-Test/1.0',
        });

        lateComponent.refresh(item);

        expect(playlistRefreshService.refreshPlaylist).toHaveBeenCalledWith(
            {
                operationId: 'playlist-refresh-op',
                playlistId: item._id,
                title: item.title,
                url: item.url,
                userAgent: item.userAgent,
                filePath: item.filePath,
            },
            {
                onEvent: expect.any(Function),
            }
        );
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();

        await Promise.resolve();
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.updatePlaylist({
                playlist: expect.objectContaining({
                    _id: item._id,
                }),
                playlistId: item._id,
                refreshEpg: true,
                operationId: 'playlist-refresh-op',
            })
        );
    });

    it('clears the connectivity guard before deleting the cached Xtream catalog', async () => {
        // Second, independent implementation of the destructive refresh (the
        // Workspace sources page). Same consequence as the shared action: the
        // catalog is already gone by the time an open guard fast-fails the
        // re-import bootstrap.
        const item = {
            _id: 'xtream-guard',
            title: 'Guarded Xtream',
            serverUrl: 'http://panel.example:8080',
        } as PlaylistMeta;
        const order: string[] = [];
        let confirmPromise: Promise<void> | undefined;

        dataService.sendIpcEvent.mockImplementation((event: string) => {
            order.push(`ipc:${event}`);
            return Promise.resolve({ success: true });
        });
        databaseService.deleteXtreamPlaylistContent.mockImplementation(() => {
            order.push('deleteXtreamPlaylistContent');
            return Promise.resolve({
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                sourcePins: [],
            });
        });
        dialogService.openConfirmDialog.mockImplementation(
            ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                confirmPromise = onConfirm?.();
            }
        );

        component.refresh(item);
        await confirmPromise;

        expect(order[0]).toBe(`ipc:${CONNECTIVITY_GUARD_RESET}`);
        expect(order).toContain('deleteXtreamPlaylistContent');
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            CONNECTIVITY_GUARD_RESET,
            { url: item.serverUrl }
        );
    });
});
