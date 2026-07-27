import { inject, Injectable, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    PlaylistBackupImportSummary,
    PlaylistBackupService,
    PlaylistBackupXtreamCredentials,
    PlaylistBackupXtreamCredentialsRequest,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { firstValueFrom } from 'rxjs';
import {
    SettingsBackupCredentialsDialogComponent,
    SettingsBackupCredentialsDialogData,
} from './settings-backup-credentials-dialog.component';
import { SettingsSnackbarService } from './settings-snackbar.service';

@Injectable()
export class SettingsBackupFacade {
    private readonly playlistBackupService = inject(PlaylistBackupService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsSnackbar = inject(SettingsSnackbarService);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly matDialog = inject(MatDialog);

    readonly includeSecrets = signal(false);
    readonly isExportingData = signal(false);

    async exportData(waitForUiFeedbackFrame: () => Promise<void>) {
        if (this.isExportingData()) {
            return;
        }

        this.isExportingData.set(true);
        await waitForUiFeedbackFrame();

        try {
            const backup = await this.playlistBackupService.exportBackup({
                includeSecrets: this.includeSecrets(),
            });

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

            this.settingsSnackbar.open('Playlist backup exported.');
        } catch (error) {
            console.error('Failed to export playlist backup:', error);
            this.settingsSnackbar.open('Playlist backup export failed.');
        } finally {
            this.isExportingData.set(false);
        }
    }

    importData(onImported: () => void): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';

        input.addEventListener('change', async (event: Event) => {
            const target = event.target as HTMLInputElement;
            const file = target.files?.[0];

            if (!file) {
                return;
            }

            try {
                const summary = await this.playlistBackupService.importBackup(
                    await file.text(),
                    {
                        resolveXtreamCredentials: (request) =>
                            this.resolveXtreamCredentials(request),
                    }
                );

                if (summary.imported > 0 || summary.merged > 0) {
                    this.store.dispatch(PlaylistActions.removeAllPlaylists());
                    this.store.dispatch(PlaylistActions.loadPlaylists());
                }

                onImported();
                this.settingsSnackbar.open(
                    this.buildBackupImportSummary(summary)
                );

                if (summary.errors.length > 0) {
                    console.error(
                        'Playlist backup import completed with issues:',
                        summary.errors
                    );
                }
            } catch (error) {
                console.error('Failed to import playlist backup:', error);
                this.settingsSnackbar.open(
                    error instanceof Error
                        ? error.message
                        : this.translate.instant('SETTINGS.IMPORT_ERROR')
                );
            }
        });

        input.click();
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

    private async resolveXtreamCredentials(
        request: PlaylistBackupXtreamCredentialsRequest
    ): Promise<PlaylistBackupXtreamCredentials | null> {
        const dialogRef = this.matDialog.open<
            SettingsBackupCredentialsDialogComponent,
            SettingsBackupCredentialsDialogData,
            PlaylistBackupXtreamCredentials | null
        >(SettingsBackupCredentialsDialogComponent, {
            data: {
                playlistTitle: request.title,
                serverHost: this.getServerHost(request.serverUrl),
            },
            maxWidth: 'calc(100vw - 32px)',
            width: '440px',
        });

        return (await firstValueFrom(dialogRef.afterClosed())) ?? null;
    }

    private getServerHost(serverUrl: string): string {
        try {
            const normalizedUrl = serverUrl.includes('://')
                ? serverUrl
                : `https://${serverUrl}`;
            return new URL(normalizedUrl).host;
        } catch {
            return '';
        }
    }

    private buildBackupImportSummary(
        summary: PlaylistBackupImportSummary
    ): string {
        return `Backup import finished: ${summary.imported} imported, ${summary.merged} merged, ${summary.skipped} skipped, ${summary.failed} failed.`;
    }
}
