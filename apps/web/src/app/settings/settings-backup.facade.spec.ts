import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
    selectAllPlaylistsMeta,
    selectIsEpgAvailable,
} from '@iptvnator/m3u-state';
import { PlaylistBackupService } from '@iptvnator/services';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockProvider } from 'ng-mocks';
import { of } from 'rxjs';
import { SettingsBackupCredentialsDialogComponent } from './settings-backup-credentials-dialog.component';
import { SettingsBackupFacade } from './settings-backup.facade';
import { SettingsSnackbarService } from './settings-snackbar.service';
import {
    BACKUP_EXPORT_RESULT,
    createElectronStub,
    MatSnackBarStub,
} from './test-stubs/settings-test-harness.stub';

describe('SettingsBackupFacade', () => {
    let facade: SettingsBackupFacade;
    let playlistBackupService: PlaylistBackupService;
    const originalElectron = window.electron;

    /** The component normally supplies a paint frame; tests skip the wait */
    const noWait = () => Promise.resolve();

    function configure(): void {
        TestBed.configureTestingModule({
            providers: [
                SettingsBackupFacade,
                SettingsSnackbarService,
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                MockProvider(MatDialog, { open: jest.fn() }),
                MockProvider(PlaylistBackupService, {
                    exportBackup: jest
                        .fn()
                        .mockResolvedValue(BACKUP_EXPORT_RESULT),
                    importBackup: jest.fn(),
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

        facade = TestBed.inject(SettingsBackupFacade);
        playlistBackupService = TestBed.inject(PlaylistBackupService);
    }

    beforeEach(() => {
        window.electron = createElectronStub();
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('shows an export busy state until the backup file has been written', async () => {
        configure();
        let resolveExport: (value: typeof BACKUP_EXPORT_RESULT) => void = () =>
            undefined;
        (playlistBackupService.exportBackup as jest.Mock).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveExport = resolve;
            })
        );

        const exportPromise = facade.exportData(noWait);

        expect(facade.isExportingData()).toBe(true);

        resolveExport(BACKUP_EXPORT_RESULT);
        await exportPromise;

        expect(window.electron.saveFileDialog).toHaveBeenCalledWith(
            BACKUP_EXPORT_RESULT.defaultFileName,
            [
                {
                    extensions: ['json'],
                    name: 'JSON',
                },
            ]
        );
        expect(window.electron.writeFile).toHaveBeenCalledWith(
            '/tmp/backup.json',
            '{}'
        );
        expect(playlistBackupService.exportBackup).toHaveBeenCalledWith({
            includeSecrets: false,
        });
        expect(facade.isExportingData()).toBe(false);
    });

    it('includes credentials only after secret export is enabled', async () => {
        configure();

        expect(facade.includeSecrets()).toBe(false);

        facade.includeSecrets.set(true);
        await facade.exportData(noWait);

        expect(playlistBackupService.exportBackup).toHaveBeenCalledWith({
            includeSecrets: true,
        });
    });

    it('resolves redacted Xtream credentials through the dialog and reports skipped entries', async () => {
        configure();
        const backupJson = JSON.stringify({
            kind: 'iptvnator-playlist-backup',
            version: 1,
            exportedAt: '2026-04-21T00:00:00.000Z',
            includeSecrets: false,
            playlists: [],
        });
        const file = {
            text: jest.fn().mockResolvedValue(backupJson),
        } as unknown as File;
        const inputClickSpy = jest
            .spyOn(HTMLInputElement.prototype, 'click')
            .mockImplementation(function (this: HTMLInputElement) {
                Object.defineProperty(this, 'files', {
                    configurable: true,
                    value: [file],
                });
                this.dispatchEvent(new Event('change'));
            });
        const matDialog = TestBed.inject(MatDialog);
        (matDialog.open as jest.Mock).mockReturnValue({
            afterClosed: () => of(undefined),
        });
        (
            playlistBackupService.importBackup as jest.Mock
        ).mockImplementationOnce(async (_json, options) => {
            const credentials = await options.resolveXtreamCredentials({
                exportedId: 'xtream-redacted',
                title: 'Living room',
                serverUrl:
                    'https://viewer:secret@provider.example:8443/player_api.php?token=private',
            });

            expect(credentials).toBeNull();

            return {
                imported: 0,
                merged: 0,
                skipped: 1,
                failed: 0,
                errors: [],
            };
        });
        let markImported: () => void = () => undefined;
        const importCompleted = new Promise<void>((resolve) => {
            markImported = resolve;
        });
        const onImported = jest.fn(() => markImported());

        try {
            facade.importData(onImported);
            await importCompleted;

            expect(playlistBackupService.importBackup).toHaveBeenCalledWith(
                backupJson,
                {
                    resolveXtreamCredentials: expect.any(Function),
                }
            );
            expect(matDialog.open).toHaveBeenCalledWith(
                SettingsBackupCredentialsDialogComponent,
                expect.objectContaining({
                    data: {
                        playlistTitle: 'Living room',
                        serverHost: 'provider.example:8443',
                    },
                })
            );
            const snackBar = TestBed.inject(
                MatSnackBar
            ) as unknown as MatSnackBarStub;
            expect(snackBar.open).toHaveBeenCalledWith(
                expect.stringContaining('1 skipped'),
                undefined,
                expect.any(Object)
            );
        } finally {
            inputClickSpy.mockRestore();
        }
    });

    it('falls back to browser backup download when desktop file-save preload is incomplete', async () => {
        const saveFileDialog = jest.fn().mockResolvedValue('/tmp/backup.json');
        window.electron = {
            platform: 'linux',
            saveFileDialog,
        } as unknown as typeof window.electron;
        configure();

        const createObjectURL = jest.fn().mockReturnValue('blob:backup');
        const revokeObjectURL = jest.fn();
        const originalCreateObjectURL = window.URL.createObjectURL;
        const originalRevokeObjectURL = window.URL.revokeObjectURL;
        Object.defineProperty(window.URL, 'createObjectURL', {
            configurable: true,
            value: createObjectURL,
        });
        Object.defineProperty(window.URL, 'revokeObjectURL', {
            configurable: true,
            value: revokeObjectURL,
        });
        const clickSpy = jest
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation();

        try {
            await facade.exportData(noWait);

            expect(saveFileDialog).not.toHaveBeenCalled();
            expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
            expect(clickSpy).toHaveBeenCalled();
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup');
        } finally {
            clickSpy.mockRestore();
            Object.defineProperty(window.URL, 'createObjectURL', {
                configurable: true,
                value: originalCreateObjectURL,
            });
            Object.defineProperty(window.URL, 'revokeObjectURL', {
                configurable: true,
                value: originalRevokeObjectURL,
            });
        }
    });

    it('reports a failed export and clears the busy state', async () => {
        configure();
        (playlistBackupService.exportBackup as jest.Mock).mockRejectedValueOnce(
            new Error('disk full')
        );
        jest.spyOn(console, 'error').mockImplementation();
        const snackBar = TestBed.inject(
            MatSnackBar
        ) as unknown as MatSnackBarStub;

        await facade.exportData(noWait);

        expect(facade.isExportingData()).toBe(false);
        expect(snackBar.open).toHaveBeenCalledWith(
            'Playlist backup export failed.',
            undefined,
            expect.objectContaining({ panelClass: ['settings-snackbar'] })
        );
    });
});
