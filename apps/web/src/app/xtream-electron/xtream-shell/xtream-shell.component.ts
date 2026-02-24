import { Component, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
    ActivatedRoute,
    NavigationEnd,
    Router,
    RouterOutlet,
} from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { PlaylistActions } from 'm3u-state';
import { LoadingOverlayComponent } from '../loading-overlay/loading-overlay.component';
import { NavigationComponent } from '../navigation/navigation.component';
import { XtreamStore } from '../stores/xtream.store';
import { filter } from 'rxjs';

@Component({
    templateUrl: './xtream-shell.component.html',
    styleUrls: ['./xtream-shell.component.scss'],
    imports: [
        LoadingOverlayComponent,
        NavigationComponent,
        RouterOutlet,
        TranslateModule,
    ],
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
    readonly isWorkspaceLayout =
        this.route.snapshot.data['layout'] === 'workspace';

    private currentPlaylistId: string | null = null;
    private currentSection: string | null = null;

    constructor() {
        // Subscribe to route params to handle switching between playlists
        this.route.params.pipe(takeUntilDestroyed()).subscribe(async (params) => {
            const newPlaylistId = params['id'];

            // Skip if playlist ID hasn't changed
            if (this.currentPlaylistId === newPlaylistId) {
                return;
            }

            // Always reset the store when playlist changes to prevent stale data
            // from previous sessions showing up (the store is a singleton)
            this.xtreamStore.resetStore(newPlaylistId);
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

        this.router.events
            .pipe(
                filter((event): event is NavigationEnd => event instanceof NavigationEnd),
                takeUntilDestroyed()
            )
            .subscribe(() => {
                this.syncSectionFromRoute();
            });

        this.syncSectionFromRoute();

        effect(() => {
            const playlist = this.xtreamStore.currentPlaylist();
            const playlistId = this.xtreamStore.playlistId();

            // Only initialize content when playlist is loaded AND matches the current playlistId
            // This prevents stale data from a previous session from being used
            if (playlist !== null && playlist.id === playlistId) {
                this.xtreamStore.initializeContent();
            }
        });
    }

    private syncSectionFromRoute(): void {
        const sectionFromSnapshot =
            this.route.firstChild?.snapshot?.url?.[0]?.path ?? null;
        const sectionFromUrl = this.getSectionFromUrl(this.router.url);
        const section = sectionFromSnapshot ?? sectionFromUrl;

        if (!section || section === this.currentSection) {
            return;
        }

        this.currentSection = section;

        if (section === 'vod' || section === 'live' || section === 'series') {
            this.xtreamStore.setSelectedContentType(section);
            return;
        }

        this.xtreamStore.setSelectedContentType(undefined);
    }

    private getSectionFromUrl(url: string): string | null {
        const match = url.match(
            /^\/(?:workspace\/)?xtreams\/[^\/\?]+\/([^\/\?]+)/
        );
        return match?.[1] ?? null;
    }
}
