import { Component, computed, inject, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistInfoComponent } from '../../home/recent-playlists/playlist-info/playlist-info.component';
import { SettingsComponent } from '../../settings/settings.component';
import { selectPlaylistById } from '../../state/selectors';
import { AccountInfoComponent } from '../account-info/account-info.component';
import { XtreamStore } from '../xtream.store';
import { NavigationItem } from './navigation.interface';

@Component({
    selector: 'app-navigation',
    imports: [
        MatIcon,
        MatIconButton,
        MatListModule,
        MatTooltip,
        RouterLink,
        RouterLinkActive,
        TranslatePipe,
    ],
    templateUrl: './navigation.component.html',
    styleUrl: './navigation.component.scss',
})
export class NavigationComponent {
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly dialog = inject(MatDialog);
    private readonly store = inject(Store);
    readonly xtreamStore = inject(XtreamStore);

    readonly portalStatus = input<'active' | 'inactive' | 'expired'>();
    readonly selectedContentType = input<string>();

    readonly categoryClick = output<string>();
    readonly pageClicked = output<'search' | 'recent' | 'favorites'>();

    readonly currentPlaylist = this.store.selectSignal(
        selectPlaylistById(this.activatedRoute.snapshot.params.id)
    );

    readonly isStalkerPlaylist = computed(
        () => this.currentPlaylist().macAddress
    );

    readonly navigationItems = input<NavigationItem[]>();

    getStatusColor(): string {
        if (this.isStalkerPlaylist()) return 'status-active';

        switch (this.portalStatus()) {
            case 'active':
                return 'status-active';
            case 'inactive':
                return 'status-inactive';
            case 'expired':
                return 'status-expired';
            default:
                return 'status-unavailable';
        }
    }

    getStatusIcon(): string {
        if (this.isStalkerPlaylist()) return 'play_circle';

        switch (this.portalStatus()) {
            case 'active':
                return 'check_circle';
            case 'inactive':
                return 'cancel';
            case 'expired':
                return 'warning';
            default:
                return 'error';
        }
    }

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

    isContentTypeActive(type: string) {
        return this.selectedContentType() === type;
    }

    openPlaylistInfo() {
        this.dialog.open(PlaylistInfoComponent, {
            data: this.currentPlaylist(),
        });
    }

    pageSwitch(page: 'search' | 'recent' | 'favorites') {
        this.pageClicked.emit(page);
        this.xtreamStore.setSelectedContentType(undefined);
    }
}
