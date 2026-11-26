import {
    ChangeDetectionStrategy,
    Component,
    inject,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { NotificationService } from '@iptvnator/services/notifications';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    PlaylistInfoComponent,
    playlistInfoDialogConfig,
} from '@iptvnator/playlist/shared/ui';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    PlaylistDeleteActionService,
    SourceActivityService,
} from '@iptvnator/services';
import {
    PlaylistMeta,
    sourceDialogSubtitle,
} from '@iptvnator/shared/interfaces';
import { DialogService } from '@iptvnator/ui/components';
import { StateViewComponent } from '@iptvnator/ui/state';

/**
 * A source that cannot show its content: the shared state view with Retry,
 * the source's settings, Home and Delete. Empty and no-results states use
 * `app-state-view` directly.
 */
@Component({
    selector: 'app-playlist-error-view',
    templateUrl: './playlist-error-view.component.html',
    styleUrls: ['./playlist-error-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatIconModule,
        RouterLink,
        StateViewComponent,
        TranslateModule,
    ],
})
export class PlaylistErrorViewComponent {
    private dialog = inject(MatDialog);
    private dialogService = inject(DialogService);
    private readonly activity = inject(SourceActivityService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly playlistDeleteAction = inject(PlaylistDeleteActionService);
    private router = inject(Router);
    private readonly notifications = inject(NotificationService);
    private store = inject(Store);
    private translate = inject(TranslateService);

    private readonly currentPlaylist = this.playlistContext.activePlaylist;

    readonly description = input<string | undefined>(undefined);
    readonly showActionButtons = input(true);
    readonly title = input<string | undefined>(undefined);
    /** `offline` when the source is unreachable rather than failing. */
    readonly variant = input<'error' | 'offline'>('error');
    /** Leads with Retry; the host reloads on `retry`. */
    readonly retryable = input(false);
    readonly retry = output<void>();

    openPlaylistDetails() {
        const playlist = this.currentPlaylist();
        if (!playlist) return;
        this.dialog.open(
            PlaylistInfoComponent,
            playlistInfoDialogConfig(playlist)
        );
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
            subtitle: sourceDialogSubtitle(currentPlaylist, (key) =>
                this.translate.instant(key)
            ),
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
        this.notifications.success('HOME.PLAYLISTS.REMOVE_DIALOG.SUCCESS');
        void this.router.navigate(['/']);
    }
}
