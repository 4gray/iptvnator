import { Component, computed, inject, input } from '@angular/core';
import { MatDividerModule } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    buildPortalRailLinks,
    PORTAL_NAVIGATION_ACTIONS,
    PortalRailSection,
} from '@iptvnator/portal/shared/util';
import { selectPlaylistById } from '@iptvnator/m3u-state';
import { Playlist } from '@iptvnator/shared/interfaces';
import { PortalRailLinksComponent } from './portal-rail-links.component';

@Component({
    selector: 'app-navigation',
    imports: [
        MatDividerModule,
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
    private readonly navigationActions = inject(PORTAL_NAVIGATION_ACTIONS);
    private readonly store = inject(Store);

    readonly portalStatus = input<
        'active' | 'inactive' | 'expired' | 'unavailable'
    >();
    readonly selectedContentType = input<PortalRailSection | undefined>();

    readonly currentPlaylist = this.store.selectSignal(
        selectPlaylistById(this.activatedRoute.snapshot.params.id)
    );

    readonly isStalkerPlaylist = computed(
        () => !!(this.currentPlaylist() as Playlist | undefined)?.macAddress
    );

    readonly isElectron = !!window.electron;

    readonly railLinks = computed(() => {
        const playlistId =
            (this.currentPlaylist() as Playlist | undefined)?._id ??
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

    openAccountInfo(): void {
        this.navigationActions.openAccountInfo();
    }

    openSettings(): void {
        this.navigationActions.openSettings();
    }

    openPlaylistInfo(): void {
        this.navigationActions.openPlaylistInfo(this.currentPlaylist());
    }
}
