import { computed, inject, Injectable, Injector, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    PlaylistBackupImportSummary,
    PlaylistBackupService,
} from '@iptvnator/services/playlist-backup';
import { SettingsSnackbarService } from './settings-snackbar.service';

@Injectable()
export class SettingsBackupFacade {
    private readonly playlistBackupService = inject(PlaylistBackupService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsSnackbar = inject(SettingsSnackbarService);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly injector = inject(Injector);

    readonly isExportingData = signal(false);
    readonly isImportingData = signal(false);
    private readonly isChoosingFile = signal(false);
    readonly isBusy = computed(
        () =>
            this.isExportingData() ||
            this.isImportingData() ||
            this.isChoosingFile()
    );
    readonly importSummary = signal<PlaylistBackupImportSummary | null>(null);
    readonly importFailed = signal(false);

    async exportData(waitForUiFeedbackFrame: () => Promise<void>) {
        if (this.isBusy()) {
            return;
        }

        this.isExportingData.set(true);
        try {
            await waitForUiFeedbackFrame();
            const backup = await this.playlistBackupService.exportBackup();

            if (this.runtime.supportsDesktopFileSave && window.electron) {
                const savePath = await window.electron.saveFileDialog(
                    backup.defaultFileName,
                    [
                        {
                            name: 'JSON',
                            extensions: ['json'],
                        },
                    ]
                );

                if (!savePath) {
                    return;
                }

                await window.electron.writeFile(savePath, backup.json);
            } else {
                this.downloadBackupInBrowser(
                    backup.defaultFileName,
                    backup.json
                );
            }

            this.settingsSnackbar.open(
                this.translate.instant('SETTINGS.BACKUP_EXPORTED')
            );
        } catch {
            this.settingsSnackbar.error(
                this.translate.instant('SETTINGS.BACKUP_EXPORT_FAILED'),
                this.translate.instant('CLOSE')
            );
        } finally {
            this.isExportingData.set(false);
        }
    }

    importData(onImported: () => void): void {
        if (this.isBusy()) return;
        this.isChoosingFile.set(true);
        const input = document.createElement('input');
        const returnFocus =
            document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener(
            'cancel',
            () => {
                this.isChoosingFile.set(false);
                this.restoreFocus(returnFocus);
            },
            { once: true }
        );

        input.addEventListener('change', async (event: Event) => {
            const target = event.target as HTMLInputElement;
            const file = target.files?.[0];

            this.isChoosingFile.set(false);
            if (!file) {
                this.restoreFocus(returnFocus);
                return;
            }
            if (this.isImportingData()) return;
            this.isImportingData.set(true);
            this.importSummary.set(null);
            this.importFailed.set(false);

            try {
                const summary = await this.playlistBackupService.importBackup(
                    await file.text()
                );
                this.injector
                    .get(XtreamStore, null)
                    ?.reconcilePendingRestoreBlock();

                if (
                    summary.imported > 0 ||
                    summary.merged > 0 ||
                    summary.failed > 0
                ) {
                    this.store.dispatch(PlaylistActions.removeAllPlaylists());
                    this.store.dispatch(PlaylistActions.loadPlaylists());
                }

                onImported();
                this.importSummary.set(summary);
            } catch {
                this.importFailed.set(true);
            } finally {
                this.isImportingData.set(false);
                this.restoreFocus(returnFocus);
            }
        });

        try {
            input.click();
        } catch {
            this.isChoosingFile.set(false);
            this.importFailed.set(true);
        }
    }

    private restoreFocus(target: HTMLElement | null): void {
        window.requestAnimationFrame(() => {
            if (
                target?.isConnected &&
                document.activeElement === document.body
            ) {
                target.focus();
            }
        });
    }

    private downloadBackupInBrowser(
        defaultFileName: string,
        json: string
    ): void {
        const blob = new Blob([json], {
            type: 'application/json',
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = defaultFileName;
        link.click();
        window.URL.revokeObjectURL(url);
    }
}
