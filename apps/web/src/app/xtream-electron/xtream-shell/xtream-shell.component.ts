import { Component, computed, effect, inject, signal } from '@angular/core';
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
import { filter } from 'rxjs';
import { PortalRailSection } from '../../shared/navigation/portal-rail-links';
import {
    isWorkspaceLayoutRoute,
    resolveCurrentPortalSection,
} from '../../shared/navigation/portal-route.utils';
import { LoadingOverlayComponent } from '../loading-overlay/loading-overlay.component';
import { NavigationComponent } from '../navigation/navigation.component';
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
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    readonly showImportOverlay = computed(() => {
        const section = this.currentSection();
        return this.isImporting() && this.isContentSection(section);
    });

    private currentPlaylistId: string | null = null;
    private readonly currentSection = signal<PortalRailSection | null>(null);

    constructor() {
        // Subscribe to route params to handle switching between playlists
        this.route.params
            .pipe(takeUntilDestroyed())
            .subscribe(async (params) => {
                const newPlaylistId = params['id'];

                // Skip if this component instance already processed this ID
                if (this.currentPlaylistId === newPlaylistId) {
                    return;
                }

                // Always reset the store when this is a fresh shell instance
                // (currentPlaylistId is null = newly created component). This
                // handles the refresh-from-sources flow where the DB content was
                // cleared but the root-scoped store still holds stale
                // isContentInitialized: true from the previous session.
                //
                // When navigating between sub-routes within the same shell
                // (live → vod → series), currentPlaylistId is already set so
                // reset is skipped and in-memory content is preserved.
                const isFreshInstance = this.currentPlaylistId === null;
                if (
                    isFreshInstance ||
                    this.xtreamStore.playlistId() !== newPlaylistId
                ) {
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

        this.router.events
            .pipe(
                filter(
                    (event): event is NavigationEnd =>
                        event instanceof NavigationEnd
                ),
                takeUntilDestroyed()
            )
            .subscribe(() => {
                this.syncSectionFromRoute();
            });

        this.syncSectionFromRoute();

        effect(() => {
            const playlist = this.xtreamStore.currentPlaylist();
            const playlistId = this.xtreamStore.playlistId();
            const section = this.currentSection();

            if (!this.isContentSection(section)) {
                return;
            }

            // Only initialize content when playlist is loaded AND matches the current playlistId
            // This prevents stale data from a previous session from being used
            if (playlist !== null && playlist.id === playlistId) {
                void this.xtreamStore.initializeContent();
            }
        });
    }

    private syncSectionFromRoute(): void {
        const section = resolveCurrentPortalSection(
            this.route,
            this.router.url,
            'xtreams'
        );

        if (!section || section === this.currentSection()) {
            return;
        }

        this.currentSection.set(section);

        if (section === 'vod' || section === 'live' || section === 'series') {
            this.xtreamStore.setSelectedContentType(section);
            return;
        }

        this.xtreamStore.setSelectedContentType(undefined);
    }

    private isContentSection(section: PortalRailSection | null): boolean {
        return (
            section === 'vod' ||
            section === 'live' ||
            section === 'series' ||
            section === 'search' ||
            section === 'recently-added'
        );
    }
}
