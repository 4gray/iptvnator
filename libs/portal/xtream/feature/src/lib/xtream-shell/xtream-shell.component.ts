import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
    ActivatedRoute,
    NavigationEnd,
    Router,
    RouterOutlet,
} from '@angular/router';
import { Store } from '@ngrx/store';
import { PlaylistActions } from 'm3u-state';
import { filter } from 'rxjs';
import {
    isWorkspaceLayoutRoute,
    PortalRailSection,
    resolveCurrentPortalSection,
} from '@iptvnator/portal/shared/util';
import { NavigationComponent } from '@iptvnator/portal/shared/ui';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { LoadingOverlayComponent } from '../loading-overlay.component';

@Component({
    templateUrl: './xtream-shell.component.html',
    styleUrls: ['./xtream-shell.component.scss'],
    imports: [LoadingOverlayComponent, NavigationComponent, RouterOutlet],
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
    readonly selectedSection = computed<PortalRailSection | undefined>(() => {
        const section = this.currentSection();
        return section ?? undefined;
    });

    private currentPlaylistId: string | null = null;
    private readonly currentSection = signal<PortalRailSection | null>(null);

    constructor() {
        this.route.params
            .pipe(takeUntilDestroyed())
            .subscribe(async (params) => {
                const newPlaylistId = params['id'];

                if (this.currentPlaylistId === newPlaylistId) {
                    return;
                }

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
        }
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
