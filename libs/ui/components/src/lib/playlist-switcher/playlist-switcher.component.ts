import { DatePipe } from '@angular/common';
import {
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenu, MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatRippleModule } from '@angular/material/core';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { selectAllPlaylistsMeta } from 'm3u-state';
import { filter } from 'rxjs';
import { PortalStatus, PortalStatusService } from 'services';
import { PlaylistMeta } from 'shared-interfaces';

@Component({
    selector: 'app-playlist-switcher',
    templateUrl: './playlist-switcher.component.html',
    styleUrls: ['./playlist-switcher.component.scss'],
    imports: [
        DatePipe,
        FormsModule,
        MatIcon,
        MatIconButton,
        MatInputModule,
        MatMenuModule,
        MatRippleModule,
        TranslatePipe,
    ],
})
export class PlaylistSwitcherComponent {
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly portalStatusService = inject(PortalStatusService);

    /** Current playlist title to display */
    readonly currentTitle = input.required<string>();
    /** Subtitle to display (e.g., "123 Channels" or "Xtream Code") */
    readonly subtitle = input<string>('');
    /** Emitted when a different playlist is selected */
    readonly playlistSelected = output<string>();

    readonly menuTrigger = viewChild.required<MatMenuTrigger>('menuTrigger');
    readonly playlistMenu = viewChild.required<MatMenu>('playlistMenu');

    /** Signal for tracking menu open state */
    readonly isMenuOpen = signal(false);

    /** Search query for filtering playlists */
    readonly searchQuery = signal('');

    /** All playlists from store */
    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);

    /** Filtered playlists based on search query */
    readonly filteredPlaylists = computed(() => {
        const query = this.searchQuery().toLowerCase().trim();
        const allPlaylists = this.playlists();
        if (!query) {
            return allPlaylists;
        }
        return allPlaylists.filter(
            (p) =>
                p.title?.toLowerCase().includes(query) ||
                p.filename?.toLowerCase().includes(query)
        );
    });

    /** Current active playlist ID from route */
    readonly activePlaylistId = signal<string | null>(null);

    /** Portal statuses for Xtream playlists */
    readonly portalStatuses = signal<Map<string, PortalStatus>>(new Map());

    constructor() {
        // Extract playlist ID from current route
        this.updateActivePlaylistFromRoute(this.router.url);

        // Listen for route changes
        this.router.events
            .pipe(
                filter((event) => event instanceof NavigationEnd),
                takeUntilDestroyed()
            )
            .subscribe((event: NavigationEnd) => {
                this.updateActivePlaylistFromRoute(event.urlAfterRedirects);
            });
    }

    private updateActivePlaylistFromRoute(url: string) {
        // Match routes like /playlists/:id, /xtreams/:id, /stalker/:id
        const match = url.match(/\/(playlists|xtreams|stalker)\/([^\/\?]+)/);
        if (match) {
            this.activePlaylistId.set(match[2]);
        } else {
            this.activePlaylistId.set(null);
        }
    }

    private async checkPortalStatuses(playlists: PlaylistMeta[]) {
        const statusPromises = playlists
            .filter(playlist => playlist.serverUrl && playlist.username && playlist.password)
            .map(async (playlist) => {
                try {
                    const status = await this.portalStatusService.checkPortalStatus(
                        playlist.serverUrl,
                        playlist.username,
                        playlist.password
                    );
                    return { id: playlist._id, status };
                } catch {
                    return { id: playlist._id, status: 'unavailable' as PortalStatus };
                }
            });

        const results = await Promise.all(statusPromises);
        const statusMap = new Map(results.map(r => [r.id, r.status]));
        this.portalStatuses.set(statusMap);
    }

    onMenuOpened() {
        this.isMenuOpen.set(true);
        this.checkPortalStatuses(this.playlists());
    }

    onMenuClosed() {
        this.isMenuOpen.set(false);
        this.searchQuery.set('');
    }

    selectPlaylist(playlist: PlaylistMeta) {
        if (playlist.serverUrl) {
            this.router.navigate(['xtreams', playlist._id]);
        } else if (playlist.macAddress) {
            this.router.navigate(['stalker', playlist._id]);
        } else {
            this.router.navigate(['playlists', playlist._id]);
        }
        this.playlistSelected.emit(playlist._id);
    }

    getPlaylistIcon(playlist: PlaylistMeta): string {
        if (playlist.macAddress) {
            return 'dashboard';
        }
        if (playlist.serverUrl) {
            return 'public';
        }
        if (playlist.url) {
            return 'cloud';
        }
        return 'folder';
    }

    getPlaylistTypeLabel(playlist: PlaylistMeta): string {
        if (playlist.macAddress) {
            return 'Stalker Portal';
        }
        if (playlist.serverUrl) {
            return 'Xtream Code';
        }
        return `${playlist.count} channels`;
    }

    getStatusClass(playlistId: string): string {
        const status = this.portalStatuses().get(playlistId);
        return this.portalStatusService.getStatusClass(status || 'unavailable');
    }

    isSelected(playlist: PlaylistMeta): boolean {
        return this.activePlaylistId() === playlist._id;
    }
}