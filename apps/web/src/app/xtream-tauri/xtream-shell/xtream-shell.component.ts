import { Component, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { PlaylistActions } from 'm3u-state';
import { LoadingOverlayComponent } from '../loading-overlay/loading-overlay.component';
import { NavigationComponent } from '../navigation/navigation.component';
import { NavigationItem } from '../navigation/navigation.interface';
import { XtreamStore } from '../stores/xtream.store';

@Component({
    templateUrl: './xtream-shell.component.html',
    styleUrls: ['./xtream-shell.component.scss'],
    imports: [
        LoadingOverlayComponent,
        NavigationComponent,
        RouterOutlet,
        TranslateModule,
    ],
    providers: [XtreamStore],
})
export class XtreamShellComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    readonly xtreamStore = inject(XtreamStore);

    readonly getImportCount = this.xtreamStore.getImportCount;
    readonly isImporting = this.xtreamStore.isImporting;
    readonly itemsToImport = this.xtreamStore.itemsToImport;
    readonly portalStatus = this.xtreamStore.portalStatus;

    readonly mainNavigationItems: NavigationItem[] = [
        {
            id: 'vod',
            icon: 'movie',
            labelKey: 'PORTALS.SIDEBAR.MOVIES',
        },
        {
            id: 'live',
            icon: 'live_tv',
            labelKey: 'PORTALS.SIDEBAR.LIVE_TV',
        },
        {
            id: 'series',
            icon: 'tv',
            labelKey: 'PORTALS.SIDEBAR.SERIES',
        },
    ];

    private currentPlaylistId: string | null = null;
    private isFirstLoad = true;

    constructor() {
        // Subscribe to route params to handle switching between playlists
        this.route.params.pipe(takeUntilDestroyed()).subscribe(async (params) => {
            const newPlaylistId = params['id'];

            // Skip if playlist ID hasn't changed (after first load)
            if (!this.isFirstLoad && this.currentPlaylistId === newPlaylistId) {
                return;
            }

            if (this.isFirstLoad) {
                // First load - just set the playlist ID without resetting
                this.xtreamStore.setPlaylistId(newPlaylistId);
                this.isFirstLoad = false;
            } else {
                // Switching to a different playlist - reset and set new ID
                this.xtreamStore.resetStore(newPlaylistId);
            }
            this.currentPlaylistId = newPlaylistId;

            this.store.dispatch(
                PlaylistActions.setActivePlaylist({
                    playlistId: newPlaylistId,
                })
            );

            // Must await fetchXtreamPlaylist before checking status
            // because checkPortalStatus needs currentPlaylist to be set
            await this.xtreamStore.fetchXtreamPlaylist();
            await this.xtreamStore.checkPortalStatus();
        });

        effect(
            () => {
                if (this.xtreamStore.currentPlaylist() !== null) {
                    this.xtreamStore.initializeContent();
                }
            },
        );
    }

    handleCategoryClick(category: 'vod' | 'live' | 'series') {
        this.xtreamStore.setSelectedContentType(category);
        this.router.navigate([category], {
            relativeTo: this.route,
        });
    }

    handlePageClick(page: 'search' | 'recent' | 'favorites' | 'recently-added') {
        this.xtreamStore.setSelectedContentType(undefined);
        this.router.navigate([page], {
            relativeTo: this.route,
        });
    }
}