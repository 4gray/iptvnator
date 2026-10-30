import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
    selectAllPlaylistsMeta,
    selectIsEpgAvailable,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaylistBackupService } from '@iptvnator/services/playlist-backup';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockProvider } from 'ng-mocks';
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
                MockProvider(PlaylistBackupService, {
                    exportBackup: jest
                        .fn()
                        .mockResolvedValue(BACKUP_EXPORT_RESULT),
                    importBackup: jest.fn(),
                }),
                MockProvider(XtreamStore, {
                    reconcilePendingRestoreBlock: jest.fn(),
                }),
                provideMockStore({
                    selectors: [
                        { selector: selectAllPlaylistsMeta, value: [] },
                        { selector: selectIsEpgAvailable, value: false },
                        { selector: selectPlaylistsLoadingFlag, value: true },
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

    it('blocks import while the save dialog is open and treats cancellation as a no-op', async () => {
        configure();
        let cancelSave!: (path: string | null) => void;
        jest.spyOn(window.electron, 'saveFileDialog').mockImplementation(
            () =>
                new Promise((resolve) => {
                    cancelSave = resolve;
                })
        );
        const create = jest.spyOn(document, 'createElement');
        const running = facade.exportData(noWait);
        // Wait for the asynchronous backup read to reach the native dialog.
        while (!cancelSave) await Promise.resolve();
        facade.importData(jest.fn());
        expect(create).not.toHaveBeenCalled();
        cancelSave(null);
        await running;
        expect(facade.isBusy()).toBe(false);
        expect(window.electron.writeFile).not.toHaveBeenCalled();
        expect(
            (TestBed.inject(MatSnackBar) as unknown as MatSnackBarStub).open
        ).not.toHaveBeenCalled();
        create.mockRestore();
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
            'SETTINGS.BACKUP_EXPORT_FAILED',
            'CLOSE',
            expect.objectContaining({
                duration: 10000,
                panelClass: ['settings-snackbar', 'settings-snackbar--error'],
            })
        );
    });

    it('reconciles a pending Xtream restore before completing an import', async () => {
        configure();
        const input = document.createElement('input');
        const file = {
            text: jest.fn().mockResolvedValue('{}'),
        } as unknown as File;
        Object.defineProperty(input, 'files', { value: [file] });
        const addEventListener = jest.spyOn(input, 'addEventListener');
        const createElement = jest
            .spyOn(document, 'createElement')
            .mockReturnValue(input);
        jest.spyOn(input, 'click').mockImplementation();
        const summary = {
            imported: 0,
            merged: 0,
            skipped: 0,
            failed: 1,
            errors: ['pending restore state could not be consumed'],
        };
        (playlistBackupService.importBackup as jest.Mock).mockResolvedValue(
            summary
        );
        const onImported = jest.fn();
        const xtreamStore = TestBed.inject(XtreamStore);

        facade.importData(onImported);
        const changeListener = addEventListener.mock.calls.find(
            ([type]) => type === 'change'
        )?.[1] as (event: Event) => Promise<void>;
        await changeListener({ target: input } as unknown as Event);

        expect(facade.importSummary()).toEqual(summary);
        expect(xtreamStore.reconcilePendingRestoreBlock).toHaveBeenCalledTimes(
            1
        );
        expect(onImported).toHaveBeenCalledTimes(1);
        expect(
            (xtreamStore.reconcilePendingRestoreBlock as jest.Mock).mock
                .invocationCallOrder[0]
        ).toBeLessThan(onImported.mock.invocationCallOrder[0]);
        createElement.mockRestore();
    });
    it('keeps import busy through file reading and blocks another import or export', async () => {
        configure();
        const input = document.createElement('input');
        let finishRead!: (text: string) => void;
        const file = {
            text: () =>
                new Promise<string>((resolve) => {
                    finishRead = resolve;
                }),
        };
        Object.defineProperty(input, 'files', { value: [file] });
        const listeners = jest.spyOn(input, 'addEventListener');
        const create = jest
            .spyOn(document, 'createElement')
            .mockReturnValue(input);
        jest.spyOn(input, 'click').mockImplementation();
        (playlistBackupService.importBackup as jest.Mock).mockResolvedValue({
            imported: 1,
            merged: 0,
            skipped: 0,
            failed: 0,
            errors: [],
        });
        try {
            facade.importData(jest.fn());
            const change = listeners.mock.calls.find(
                ([name]) => name === 'change'
            )?.[1] as (event: Event) => Promise<void>;
            const running = change({ target: input } as unknown as Event);
            facade.importData(jest.fn());
            await facade.exportData(noWait);
            expect(create).toHaveBeenCalledTimes(1);
            expect(playlistBackupService.exportBackup).not.toHaveBeenCalled();
            expect(
                (
                    facade as unknown as { isImportingData: () => boolean }
                ).isImportingData()
            ).toBe(true);
            finishRead('{}');
            await running;
            expect(
                (
                    facade as unknown as { isImportingData: () => boolean }
                ).isImportingData()
            ).toBe(false);
        } finally {
            create.mockRestore();
        }
    });

    it.each([false, true])(
        'waits for source loading and rendering before returning focus (focus moved: %s)',
        async (moved) => {
            configure();
            const store = TestBed.inject(MockStore);
            const ready = store.overrideSelector(
                selectPlaylistsLoadingFlag,
                false
            );
            const trigger = document.createElement('button');
            const other = document.createElement('button');
            document.body.append(trigger, other);
            trigger.focus();
            const input = document.createElement('input');
            Object.defineProperty(input, 'files', {
                value: [{ text: () => Promise.resolve('{}') }],
            });
            const listeners = jest.spyOn(input, 'addEventListener');
            const create = jest
                .spyOn(document, 'createElement')
                .mockReturnValue(input);
            jest.spyOn(input, 'click').mockImplementation();
            (playlistBackupService.importBackup as jest.Mock).mockResolvedValue(
                { imported: 1, merged: 0, skipped: 0, failed: 0, errors: [] }
            );
            try {
                facade.importData(jest.fn());
                trigger.disabled = true;
                other.focus();
                other.blur();
                const change = listeners.mock.calls.find(
                    ([name]) => name === 'change'
                )?.[1] as (event: Event) => Promise<void>;
                await change({ target: input } as unknown as Event);
                await new Promise<void>((done) =>
                    requestAnimationFrame(() => done())
                );
                expect(document.activeElement).not.toBe(trigger);
                trigger.disabled = false;
                if (moved) other.focus();
                ready.setResult(true);
                store.refreshState();
                TestBed.tick();
                expect(document.activeElement).toBe(moved ? other : trigger);
            } finally {
                create.mockRestore();
                trigger.remove();
                other.remove();
            }
        }
    );

    it('does not disclose file or storage contents when an import fails', async () => {
        configure();
        const input = document.createElement('input');
        Object.defineProperty(input, 'files', {
            value: [
                {
                    text: () =>
                        Promise.reject(new Error('private-fixture-value')),
                },
            ],
        });
        const listeners = jest.spyOn(input, 'addEventListener');
        const create = jest
            .spyOn(document, 'createElement')
            .mockReturnValue(input);
        jest.spyOn(input, 'click').mockImplementation();
        const log = jest.spyOn(console, 'error').mockImplementation();
        try {
            facade.importData(jest.fn());
            const change = listeners.mock.calls.find(
                ([name]) => name === 'change'
            )?.[1] as (event: Event) => Promise<void>;
            await change({ target: input } as unknown as Event);
            const snack = TestBed.inject(
                MatSnackBar
            ) as unknown as MatSnackBarStub;
            expect(JSON.stringify(snack.open.mock.calls)).not.toContain(
                'private-fixture-value'
            );
            expect(JSON.stringify(log.mock.calls)).not.toContain(
                'private-fixture-value'
            );
        } finally {
            create.mockRestore();
            log.mockRestore();
        }
    });
});
