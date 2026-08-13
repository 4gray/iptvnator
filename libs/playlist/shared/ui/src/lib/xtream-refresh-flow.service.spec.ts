import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { DialogService } from '@iptvnator/ui/components';
import {
    DataService,
    DatabaseService,
    DbOperationEvent,
    PlaybackPositionService,
} from '@iptvnator/services';
import {
    CONNECTIVITY_GUARD_RESET,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import {
    XtreamRefreshFlowService,
    type XtreamRefreshProgressReporter,
    type XtreamRefreshRun,
} from './xtream-refresh-flow.service';

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
        serverUrl: 'http://panel.example:8080',
        username: 'demo',
        password: 'secret',
        ...overrides,
    } as PlaylistMeta;
}

/**
 * Records the reporter contract as the flow exercises it. `overrides` replaces
 * individual hooks — notably `isBusy`, and `waitForVisibleProgress`, which the
 * sources page deliberately does not implement.
 */
function createReporter(
    overrides: Partial<XtreamRefreshProgressReporter> = {}
) {
    const calls: string[] = [];
    const runs: XtreamRefreshRun[] = [];
    const events: DbOperationEvent[] = [];

    const reporter: XtreamRefreshProgressReporter = {
        isBusy: () => false,
        begin: (run) => {
            calls.push('begin');
            runs.push(run);
        },
        report: (run, event) => {
            calls.push('report');
            runs.push(run);
            events.push(event);
        },
        end: (run) => {
            calls.push('end');
            runs.push(run);
        },
        ...overrides,
    };

    return { reporter, calls, runs, events };
}

describe('XtreamRefreshFlowService', () => {
    let service: XtreamRefreshFlowService;
    let confirmPromise: Promise<void> | undefined;
    let order: string[];
    let databaseService: {
        createOperationId: jest.Mock;
        deleteXtreamPlaylistContent: jest.Mock;
        updateXtreamPlaylistDetails: jest.Mock;
    };
    let dataService: { sendIpcEvent: jest.Mock };
    let dialogService: { openConfirmDialog: jest.Mock };
    let playbackPositionService: { getAllPlaybackPositions: jest.Mock };
    let router: { navigate: jest.Mock };
    let snackBar: { open: jest.Mock };
    let store: { dispatch: jest.Mock };

    beforeEach(() => {
        localStorage.clear();
        confirmPromise = undefined;
        order = [];

        databaseService = {
            createOperationId: jest.fn((prefix: string) => `${prefix}-op`),
            deleteXtreamPlaylistContent: jest.fn(() => {
                order.push('delete');
                return Promise.resolve({
                    success: true,
                    favorites: [],
                    recentlyViewed: [],
                    hiddenCategories: [],
                });
            }),
            updateXtreamPlaylistDetails: jest.fn().mockResolvedValue(true),
        };
        dataService = {
            sendIpcEvent: jest.fn((event: string) => {
                order.push(`ipc:${event}`);
                return Promise.resolve({ success: true });
            }),
        };
        dialogService = {
            openConfirmDialog: jest.fn(
                ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                    confirmPromise = onConfirm?.();
                }
            ),
        };
        playbackPositionService = {
            getAllPlaybackPositions: jest.fn().mockResolvedValue([]),
        };
        router = { navigate: jest.fn().mockResolvedValue(true) };
        snackBar = { open: jest.fn() };
        store = { dispatch: jest.fn() };

        TestBed.configureTestingModule({
            providers: [
                XtreamRefreshFlowService,
                { provide: Router, useValue: router },
                { provide: Store, useValue: store },
                {
                    provide: TranslateService,
                    useValue: { instant: jest.fn((key: string) => key) },
                },
                { provide: MatSnackBar, useValue: snackBar },
                { provide: DialogService, useValue: dialogService },
                { provide: DatabaseService, useValue: databaseService },
                { provide: DataService, useValue: dataService },
                {
                    provide: PlaybackPositionService,
                    useValue: playbackPositionService,
                },
            ],
        });

        service = TestBed.inject(XtreamRefreshFlowService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('ignores a confirmation that arrives while the playlist is already busy', async () => {
        const { reporter, calls } = createReporter({ isBusy: () => true });

        service.confirmAndRefresh(createPlaylistMeta(), reporter);
        await confirmPromise;

        expect(calls).toEqual([]);
        expect(databaseService.createOperationId).not.toHaveBeenCalled();
        expect(
            databaseService.deleteXtreamPlaylistContent
        ).not.toHaveBeenCalled();
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('serializes destructive runs for one playlist across entry points', async () => {
        const item = createPlaylistMeta();
        const confirms: Array<Promise<void> | undefined> = [];
        let deleteStarted!: () => void;
        const deleteHasStarted = new Promise<void>((resolve) => {
            deleteStarted = resolve;
        });
        let releaseDelete!: (state: unknown) => void;
        const deleteSettles = new Promise((resolve) => {
            releaseDelete = resolve;
        });

        databaseService.deleteXtreamPlaylistContent.mockImplementation(() => {
            order.push('delete');
            deleteStarted();
            return deleteSettles;
        });
        dialogService.openConfirmDialog.mockImplementation(
            ({ onConfirm }: { onConfirm?: () => Promise<void> }) => {
                confirms.push(onConfirm?.());
            }
        );

        const header = createReporter();
        const sourcesRow = createReporter();

        service.confirmAndRefresh(item, header.reporter);
        await deleteHasStarted;

        // The row's reporter honestly reports "not busy": it tracks its own id
        // set and never saw the header action start. Only the flow can refuse
        // this, and it must refuse before the guard reset — a second run would
        // park an already-emptied catalog over the first run's snapshot.
        service.confirmAndRefresh(item, sourcesRow.reporter);
        await Promise.resolve();

        expect(sourcesRow.calls).toEqual([]);
        expect(
            databaseService.deleteXtreamPlaylistContent
        ).toHaveBeenCalledTimes(1);
        expect(dataService.sendIpcEvent).toHaveBeenCalledTimes(1);

        releaseDelete({
            success: true,
            favorites: [],
            recentlyViewed: [],
            hiddenCategories: [],
        });
        await Promise.all(confirms);

        expect(header.calls).toEqual(['begin', 'end']);

        // The block lifts with the run: a refresh that already finished must
        // not strand the playlist.
        service.confirmAndRefresh(item, sourcesRow.reporter);
        await confirms[confirms.length - 1];

        expect(sourcesRow.calls).toEqual(['begin', 'end']);
        expect(
            databaseService.deleteXtreamPlaylistContent
        ).toHaveBeenCalledTimes(2);
    });

    it('marks the run busy before the guard reset and any destructive work', async () => {
        const { reporter, runs } = createReporter({
            begin: (run) => {
                order.push('begin');
                runs.push(run);
            },
        });

        service.confirmAndRefresh(createPlaylistMeta(), reporter);

        // Everything up to the first await has run: the reporter is already
        // busy (so an entry point rendering from `begin()` can paint) and the
        // guard reset is already on the wire, while nothing destructive has
        // started. `resetHostConnectivityGuard` dispatches its IPC
        // synchronously and only awaits the reply, hence the reset appearing
        // here rather than after the first tick.
        expect(order).toEqual(['begin', `ipc:${CONNECTIVITY_GUARD_RESET}`]);
        expect(runs[0]).toEqual({
            playlistId: 'playlist-1',
            operationId: 'xtream-refresh-op',
        });
        expect(
            databaseService.deleteXtreamPlaylistContent
        ).not.toHaveBeenCalled();

        await confirmPromise;
    });

    it('resets the connectivity guard, then waits for the reporter, then deletes', async () => {
        const { reporter } = createReporter({
            waitForVisibleProgress: () => {
                order.push('wait');
                return Promise.resolve();
            },
        });
        const item = createPlaylistMeta();

        service.confirmAndRefresh(item, reporter);
        await confirmPromise;

        expect(order).toEqual([
            `ipc:${CONNECTIVITY_GUARD_RESET}`,
            'wait',
            'delete',
        ]);
        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            CONNECTIVITY_GUARD_RESET,
            { url: item.serverUrl }
        );
    });

    it('completes for a reporter that implements no paint hook', async () => {
        const { reporter, calls } = createReporter();
        const item = createPlaylistMeta();

        service.confirmAndRefresh(item, reporter);
        await confirmPromise;

        expect(order).toEqual([`ipc:${CONNECTIVITY_GUARD_RESET}`, 'delete']);
        expect(calls).toEqual(['begin', 'end']);
        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            item._id,
        ]);
    });

    it('forwards delete progress to the reporter under the same run', async () => {
        const { reporter, events, runs } = createReporter();
        const progressEvent: DbOperationEvent = {
            operation: 'delete-xtream-content',
            operationId: 'xtream-refresh-op',
            status: 'progress',
            phase: 'deleting-content',
            current: 50,
            total: 100,
        };
        databaseService.deleteXtreamPlaylistContent.mockImplementation(
            (
                _playlistId: string,
                options?: {
                    operationId?: string;
                    onEvent?: (event: DbOperationEvent) => void;
                }
            ) => {
                options?.onEvent?.(progressEvent);
                return Promise.resolve({
                    success: true,
                    favorites: [],
                    recentlyViewed: [],
                    hiddenCategories: [],
                });
            }
        );

        service.confirmAndRefresh(createPlaylistMeta(), reporter);
        await confirmPromise;

        expect(events).toEqual([progressEvent]);
        // Every hook sees the same run, so a reporter can scope its state to
        // this operation and ignore events from an older one.
        expect(new Set(runs.map(({ operationId }) => operationId))).toEqual(
            new Set(['xtream-refresh-op'])
        );
    });

    it('ends the run without an error toast when the delete is aborted', async () => {
        const { reporter, calls } = createReporter();
        databaseService.deleteXtreamPlaylistContent.mockRejectedValue(
            createAbortError()
        );

        service.confirmAndRefresh(createPlaylistMeta(), reporter);
        await confirmPromise;

        expect(calls).toEqual(['begin', 'end']);
        expect(snackBar.open).not.toHaveBeenCalledWith(
            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.ERROR',
            undefined,
            { duration: 3000 }
        );
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('reports a failed delete and still ends the run', async () => {
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation();
        const { reporter, calls } = createReporter();
        databaseService.deleteXtreamPlaylistContent.mockRejectedValue(
            new Error('Refresh failed')
        );

        service.confirmAndRefresh(createPlaylistMeta(), reporter);
        await confirmPromise;

        expect(calls).toEqual(['begin', 'end']);
        expect(snackBar.open).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.ERROR',
            undefined,
            { duration: 3000 }
        );
        expect(router.navigate).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});
