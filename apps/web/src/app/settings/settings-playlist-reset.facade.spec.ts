import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
    PlaylistActions,
    selectAllPlaylistsMeta,
    selectIsEpgAvailable,
} from '@iptvnator/m3u-state';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MockProvider } from 'ng-mocks';
import { of } from 'rxjs';
import { SettingsPlaylistResetFacade } from './settings-playlist-reset.facade';
import { SettingsSnackbarService } from './settings-snackbar.service';
import {
    createDialogRef,
    createElectronStub,
    createPlaylistMeta,
    MatSnackBarStub,
} from './settings-test-harness.stub';

describe('SettingsPlaylistResetFacade', () => {
    let facade: SettingsPlaylistResetFacade;
    let matDialog: MatDialog;
    let databaseService: DatabaseService;
    let playlistsService: PlaylistsService;
    let store: Store;
    let mockStore: MockStore;
    let snackBar: MatSnackBarStub;
    let translate: TranslateService;
    const originalElectron = window.electron;

    /** The component normally supplies a paint frame; tests skip the wait */
    const noWait = () => Promise.resolve();

    function setPlaylists(playlists: PlaylistMeta[]): void {
        mockStore.overrideSelector(selectAllPlaylistsMeta, playlists);
        mockStore.refreshState();
    }

    beforeEach(() => {
        window.electron = createElectronStub();

        TestBed.configureTestingModule({
            providers: [
                SettingsPlaylistResetFacade,
                SettingsSnackbarService,
                MockProvider(MatDialog, { open: jest.fn() }),
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                MockProvider(DatabaseService, {
                    createOperationId: jest
                        .fn()
                        .mockReturnValue('delete-all-op'),
                    deleteAllPlaylists: jest.fn().mockResolvedValue(true),
                }),
                MockProvider(PlaylistsService, {
                    removeAll: jest.fn().mockReturnValue(of(undefined)),
                }),
                provideMockStore({
                    selectors: [
                        { selector: selectAllPlaylistsMeta, value: [] },
                        { selector: selectIsEpgAvailable, value: false },
                    ],
                }),
            ],
            imports: [TranslateModule.forRoot()],
        });

        facade = TestBed.inject(SettingsPlaylistResetFacade);
        matDialog = TestBed.inject(MatDialog);
        databaseService = TestBed.inject(DatabaseService);
        playlistsService = TestBed.inject(PlaylistsService);
        store = TestBed.inject(Store);
        mockStore = TestBed.inject(MockStore);
        snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarStub;
        translate = TestBed.inject(TranslateService);
        jest.spyOn(translate, 'instant').mockImplementation(
            (key: string, params?: Record<string, number>) =>
                key === 'SETTINGS.REMOVE_ALL_PROGRESS'
                    ? `${params?.current}/${params?.total}`
                    : key
        );
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('refuses the global wipe when there are no playlists', () => {
        setPlaylists([]);

        expect(facade.deleteSummary().total).toBe(0);
        expect(facade.canRemoveAll()).toBe(false);

        facade.confirmAndRemoveAll(noWait);

        expect(matDialog.open).not.toHaveBeenCalled();
    });

    it('opens the dedicated delete-all dialog with the current playlist type summary', () => {
        setPlaylists([
            createPlaylistMeta({ _id: 'm3u-1' }),
            createPlaylistMeta({
                _id: 'xtream-1',
                serverUrl: 'http://xtream.example',
            }),
            createPlaylistMeta({
                _id: 'stalker-1',
                macAddress: '00:11:22:33:44:55',
            }),
        ]);
        const openSpy = jest
            .spyOn(matDialog, 'open')
            .mockReturnValue(createDialogRef(false));

        facade.confirmAndRemoveAll(noWait);

        expect(facade.deleteSummary()).toEqual({
            total: 3,
            m3u: 1,
            xtream: 1,
            stalker: 1,
        });
        expect(openSpy).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                data: {
                    summary: {
                        total: 3,
                        m3u: 1,
                        xtream: 1,
                        stalker: 1,
                    },
                },
            })
        );
    });

    it('tracks Electron delete-all progress and dispatches store cleanup after success', async () => {
        setPlaylists([
            createPlaylistMeta({ _id: 'm3u-1' }),
            createPlaylistMeta({
                _id: 'xtream-1',
                serverUrl: 'http://xtream.example',
            }),
        ]);
        const dispatchSpy = jest.spyOn(store, 'dispatch');
        jest.spyOn(matDialog, 'open').mockReturnValue(createDialogRef(true));

        let resolveDelete: (value: boolean) => void = () => undefined;
        (databaseService.deleteAllPlaylists as jest.Mock).mockImplementation(
            ({
                onEvent,
            }: {
                onEvent?: (event: {
                    operation: string;
                    status: string;
                    current?: number;
                    total?: number;
                }) => void;
            }) => {
                onEvent?.({
                    operation: 'delete-all-playlists',
                    status: 'progress',
                    current: 3,
                    total: 7,
                });

                return new Promise<boolean>((resolve) => {
                    resolveDelete = resolve;
                });
            }
        );

        facade.confirmAndRemoveAll(noWait);
        await Promise.resolve();

        expect(facade.isRemovingAllPlaylists()).toBe(true);
        expect(facade.removeAllProgressLabel()).toBe('3/7');
        expect(databaseService.deleteAllPlaylists).toHaveBeenCalledWith(
            expect.objectContaining({
                operationId: 'delete-all-op',
                onEvent: expect.any(Function),
            })
        );

        resolveDelete(true);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(facade.isRemovingAllPlaylists()).toBe(false);
        expect(facade.removeAllProgress()).toBeNull();
        expect(dispatchSpy).toHaveBeenCalledWith(
            PlaylistActions.removeAllPlaylists()
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.PLAYLISTS_REMOVED',
            undefined,
            {
                duration: 2000,
                horizontalPosition: 'center',
                panelClass: ['settings-snackbar'],
                verticalPosition: 'bottom',
            }
        );
    });

    it('falls back to PlaylistsService.removeAll outside Electron', async () => {
        window.electron = undefined as unknown as typeof window.electron;
        setPlaylists([createPlaylistMeta({ _id: 'browser-m3u' })]);
        const dispatchSpy = jest.spyOn(store, 'dispatch');
        jest.spyOn(matDialog, 'open').mockReturnValue(createDialogRef(true));

        facade.confirmAndRemoveAll(noWait);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(playlistsService.removeAll).toHaveBeenCalled();
        expect(databaseService.deleteAllPlaylists).not.toHaveBeenCalled();
        expect(dispatchSpy).toHaveBeenCalledWith(
            PlaylistActions.removeAllPlaylists()
        );
    });

    it('surfaces a failure snackbar when the wipe reports no success', async () => {
        setPlaylists([createPlaylistMeta({ _id: 'm3u-1' })]);
        (databaseService.deleteAllPlaylists as jest.Mock).mockResolvedValue(
            false
        );
        jest.spyOn(matDialog, 'open').mockReturnValue(createDialogRef(true));
        jest.spyOn(console, 'error').mockImplementation();

        facade.confirmAndRemoveAll(noWait);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(facade.isRemovingAllPlaylists()).toBe(false);
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.PLAYLISTS_REMOVE_FAILED',
            undefined,
            expect.objectContaining({ panelClass: ['settings-snackbar'] })
        );
    });
});
