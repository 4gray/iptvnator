import { Component, computed, inject, input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaylistInfoComponent } from 'components';
import { selectPlaylistById } from 'm3u-state';
import { Playlist } from 'shared-interfaces';
import { SettingsComponent } from '../../settings/settings.component';
import { AccountInfoComponent } from '../account-info/account-info.component';
import { XtreamStore } from '../stores/xtream.store';
import { buildPortalRailLinks } from '../../shared/navigation/portal-rail-links';
import { PortalRailLinksComponent } from '../../shared/navigation/portal-rail-links.component';

@Component({
    selector: 'app-navigation',
    imports: [
        MatIcon,
        MatListModule,
        MatTooltip,
        RouterLink,
        RouterLinkActive,
        TranslatePipe,
        PortalRailLinksComponent,
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

    readonly currentPlaylist = this.store.selectSignal(
        selectPlaylistById(this.activatedRoute.snapshot.params.id)
    );

    readonly isStalkerPlaylist = computed(
        () => !!(this.currentPlaylist() as Playlist)?.macAddress
    );

    /** Check if running in Electron (downloads only available in desktop) */
    readonly isElectron = !!window.electron;

    readonly railLinks = computed(() => {
        const playlistId =
            (this.currentPlaylist() as Playlist | null)?._id ??
            this.activatedRoute.snapshot.params['id'];
        if (!playlistId) {
            return { primary: [], secondary: [] };
        }

        return buildPortalRailLinks({
            provider: this.isStalkerPlaylist() ? 'stalker' : 'xtreams',
            playlistId,
            isElectron: this.isElectron,
            workspace: false,
        });
    });
    readonly primaryLinks = computed(() => this.railLinks().primary);
    readonly secondaryLinks = computed(() => this.railLinks().secondary);

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
            width: '1200px',
            maxWidth: '96vw',
            maxHeight: '92vh',
            data: {
                isDialog: true,
            },
        });
    }

    openPlaylistInfo() {
        this.dialog.open(PlaylistInfoComponent, {
            data: this.currentPlaylist(),
        });
    }
}
