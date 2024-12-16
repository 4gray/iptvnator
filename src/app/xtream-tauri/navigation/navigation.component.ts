import { Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { PlaylistInfoComponent } from '../../home/recent-playlists/playlist-info/playlist-info.component';
import { SettingsComponent } from '../../settings/settings.component';
import { selectActivePlaylist } from '../../state/selectors';
import { AccountInfoComponent } from '../account-info/account-info.component';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-navigation',
    standalone: true,
    imports: [
        MatListModule,
        MatIconModule,
        RouterLink,
        RouterLinkActive,
        TranslateModule,
    ],
    templateUrl: './navigation.component.html',
    styleUrl: './navigation.component.scss',
})
export class NavigationComponent {
    private readonly dialog = inject(MatDialog);
    private readonly store = inject(Store);
    readonly xtreamStore = inject(XtreamStore);

    private readonly currentPlaylist =
        this.store.selectSignal(selectActivePlaylist);

    openAccountInfo() {
        this.dialog.open(AccountInfoComponent, {
            width: '80%',
            maxWidth: '1200px',
            maxHeight: '90vh',
            data: {
                vodStreamsCount: this.xtreamStore.vodStreams().length,
                liveStreamsCount: this.xtreamStore.liveStreams().length,
                seriesCount: this.xtreamStore.serialStreams().length,
            },
        });
    }

    openSettings() {
        this.dialog.open(SettingsComponent, {
            width: '80%',
            maxWidth: '1200px',
            maxHeight: '90vh',
            data: {
                isDialog: true,
            },
        });
    }

    isContentTypeActive(type: 'live' | 'vod' | 'series'): boolean {
        return this.xtreamStore.selectedContentType() === type;
    }

    openPlaylistInfo() {
        this.dialog.open(PlaylistInfoComponent, {
            data: this.currentPlaylist(),
        });
    }
}
