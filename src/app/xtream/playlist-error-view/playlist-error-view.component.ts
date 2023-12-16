import { Component, Input, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlaylistInfoComponent } from '../../home/recent-playlists/playlist-info/playlist-info.component';
import { DialogService } from '../../services/dialog.service';
import * as PlaylistActions from '../../state/actions';
import { selectCurrentPlaylist } from '../../state/selectors';

@Component({
    standalone: true,
    selector: 'app-playlist-error-view',
    templateUrl: './playlist-error-view.component.html',
    styleUrls: ['./playlist-error-view.component.scss'],
    imports: [MatButtonModule, MatIconModule, RouterLink, TranslateModule],
})
export class PlaylistErrorViewComponent {
    dialog = inject(MatDialog);
    dialogService = inject(DialogService);
    router = inject(Router);
    store = inject(Store);
    translate = inject(TranslateService);

    currentPlaylist = this.store.selectSignal(selectCurrentPlaylist);

    @Input() title: string;
    @Input() description: string;

    openPlaylistDetails() {
        this.dialog.open(PlaylistInfoComponent, {
            data: this.currentPlaylist(),
        });
    }

    removeClicked(): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.TITLE'),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REMOVE_DIALOG.MESSAGE'
            ),
            onConfirm: (): void =>
                this.removePlaylist(this.currentPlaylist()._id),
        });
    }

    removePlaylist(playlistId: string): void {
        this.store.dispatch(PlaylistActions.removePlaylist({ playlistId }));
        this.router.navigate(['/']);
    }
}
