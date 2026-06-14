import { inject, Injectable, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    DatabaseService,
    DbOperationEvent,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { SettingsSnackbarService } from './settings-snackbar.service';

@Injectable()
export class SettingsPlaylistResetFacade {
    private readonly databaseService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsSnackbar = inject(SettingsSnackbarService);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);

    readonly isRemovingAllPlaylists = signal(false);
    readonly removeAllProgress = signal<DbOperationEvent | null>(null);

    async removeAllConfirmed(
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
