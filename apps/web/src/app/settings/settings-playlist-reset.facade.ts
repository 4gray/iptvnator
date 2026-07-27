import { computed, inject, Injectable, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, take } from 'rxjs';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import {
    DatabaseService,
    DbOperationEvent,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    SettingsDeleteAllPlaylistsDialogComponent,
    SettingsDeleteAllPlaylistsDialogData,
} from './settings-delete-all-playlists-dialog.component';
import {
    buildRemoveAllProgressLabel,
    buildSettingsPlaylistDeleteSummary,
} from './settings-playlist-summary.utils';
import { SettingsPlaylistDeleteSummary } from './settings.models';
import { SettingsSnackbarService } from './settings-snackbar.service';

@Injectable()
export class SettingsPlaylistResetFacade {
    private readonly databaseService = inject(DatabaseService);
    private readonly matDialog = inject(MatDialog);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsSnackbar = inject(SettingsSnackbarService);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);

    readonly isRemovingAllPlaylists = signal(false);
    readonly removeAllProgress = signal<DbOperationEvent | null>(null);

    private readonly playlists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );

    readonly deleteSummary = computed<SettingsPlaylistDeleteSummary>(() =>
        buildSettingsPlaylistDeleteSummary(this.playlists())
    );

    readonly canRemoveAll = computed(
        () => !this.isRemovingAllPlaylists() && this.deleteSummary().total > 0
    );

    readonly removeAllProgressLabel = computed(() =>
        buildRemoveAllProgressLabel({
            isRemovingAllPlaylists: this.isRemovingAllPlaylists(),
            progress: this.removeAllProgress(),
            translate: (key, params) => this.translate.instant(key, params),
        })
    );

    /**
     * Asks for confirmation in a dedicated dialog before wiping every
     * playlist, so the summary of what is about to be lost is visible.
     */
    confirmAndRemoveAll(waitForUiFeedbackFrame: () => Promise<void>): void {
        if (!this.canRemoveAll()) {
            return;
        }

        this.matDialog
            .open<
                SettingsDeleteAllPlaylistsDialogComponent,
                SettingsDeleteAllPlaylistsDialogData,
                boolean
            >(SettingsDeleteAllPlaylistsDialogComponent, {
                autoFocus: false,
                data: {
                    summary: this.deleteSummary(),
                },
                maxWidth: 'calc(100vw - 32px)',
                restoreFocus: true,
                width: '460px',
            })
            .afterClosed()
            .pipe(take(1))
            .subscribe((confirmed) => {
                if (confirmed) {
                    void this.removeAllConfirmed(waitForUiFeedbackFrame);
                }
            });
    }

    private async removeAllConfirmed(
        waitForUiFeedbackFrame: () => Promise<void>
    ): Promise<void> {
        if (this.isRemovingAllPlaylists()) {
            return;
        }

        this.isRemovingAllPlaylists.set(true);
        this.removeAllProgress.set(null);

        await waitForUiFeedbackFrame();

        try {
            const deleted =
                this.runtime.isElectron && window.electron
                    ? await this.deleteAllPlaylistsInElectron()
                    : await this.deleteAllPlaylistsInBrowser();

            if (!deleted) {
                throw new Error('Delete all playlists returned success=false');
            }

            this.store.dispatch(PlaylistActions.removeAllPlaylists());
            this.settingsSnackbar.open(
                this.translate.instant('SETTINGS.PLAYLISTS_REMOVED')
            );
        } catch (error) {
            console.error('Error removing playlists:', error);
            this.settingsSnackbar.open(
                this.translate.instant('SETTINGS.PLAYLISTS_REMOVE_FAILED')
            );
        } finally {
            this.removeAllProgress.set(null);
            this.isRemovingAllPlaylists.set(false);
        }
    }

    private async deleteAllPlaylistsInElectron(): Promise<boolean> {
        return this.databaseService.deleteAllPlaylists({
            operationId: this.databaseService.createOperationId(
                'settings-delete-all-playlists'
            ),
            onEvent: (event) => this.handleDeleteAllPlaylistsEvent(event),
        });
    }

    private async deleteAllPlaylistsInBrowser(): Promise<boolean> {
        await firstValueFrom(this.playlistsService.removeAll());
        return true;
    }

    private handleDeleteAllPlaylistsEvent(event: DbOperationEvent): void {
        this.removeAllProgress.set(event);
    }
}
