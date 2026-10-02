import {
    Component,
    inject,
    input,
    ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistInfoComponent } from '@iptvnator/playlist/shared/ui';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    PlaylistDeleteActionService,
    SourceActivityService,
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { DialogService } from '@iptvnator/ui/components';

@Component({
    selector: 'app-playlist-error-view',
    templateUrl: './playlist-error-view.component.html',
    styleUrls: ['./playlist-error-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [MatButtonModule, MatIconModule, RouterLink, TranslateModule],
})
export class PlaylistErrorViewComponent {
    private dialog = inject(MatDialog);
    private dialogService = inject(DialogService);
    private readonly activity = inject(SourceActivityService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly playlistDeleteAction = inject(PlaylistDeleteActionService);
    private router = inject(Router);
    private readonly snackBar = inject(MatSnackBar);
    private store = inject(Store);
    private translate = inject(TranslateService);

    private readonly currentPlaylist = this.playlistContext.activePlaylist;

    readonly description = input<string | undefined>(undefined);
    readonly showIllustration = input(true);
    readonly showActionButtons = input(true);
    readonly title = input<string | undefined>(undefined);
    readonly viewType = input<'ERROR' | 'EMPTY_CATEGORY' | 'NO_SEARCH_RESULTS'>(
        'ERROR'
    );

    openPlaylistDetails() {
        this.dialog.open(PlaylistInfoComponent, {
            data: this.currentPlaylist(),
        });
    }

    removeClicked(): void {
        const currentPlaylist = this.currentPlaylist();
        if (
            !currentPlaylist?._id ||
            this.activity.isBusy(currentPlaylist._id)
        ) {
            return;
        }

        this.dialogService.openConfirmDialog({
            title: this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.TITLE'),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REMOVE_DIALOG.MESSAGE'
            ),
            confirmLabel: this.translate.instant('HOME.PLAYLISTS.REMOVE'),
            tone: 'destructive',
            onConfirm: (): void => void this.removePlaylist(currentPlaylist),
        });
    }

    /**
     * Same path as every other source removal: the shared delete action marks
     * the source busy, lets persistence drop the Xtream cache and cleanups,
     * and only a completed delete is committed to the store.
     */
    async removePlaylist(playlist: PlaylistMeta): Promise<void> {
        if (this.activity.isBusy(playlist._id)) {
            return;
        }

        const deleted =
            await this.playlistDeleteAction.deletePlaylist(playlist);
        if (!deleted) {
            return;
        }

        this.store.dispatch(
            PlaylistActions.playlistRemovalCommitted({
                playlistId: playlist._id,
            })
        );
        this.snackBar.open(
            this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.SUCCESS'),
            undefined,
            { duration: 2000 }
        );
        void this.router.navigate(['/']);
    }
}
