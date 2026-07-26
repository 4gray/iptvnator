import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
    selectAllPlaylistsMeta,
    selectIsEpgAvailable,
} from '@iptvnator/m3u-state';
import { PlaylistBackupService } from '@iptvnator/services';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockProvider } from 'ng-mocks';
import { SettingsBackupFacade } from './settings-backup.facade';
import { SettingsSnackbarService } from './settings-snackbar.service';
import {
    BACKUP_EXPORT_RESULT,
    createElectronStub,
    MatSnackBarStub,
} from './settings-test-harness.stub';

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
        expect(facade.isExportingData()).toBe(false);
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
