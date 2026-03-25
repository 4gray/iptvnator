import {
    DestroyRef,
    ENVIRONMENT_INITIALIZER,
    inject,
    Injectable,
    Provider,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
    ActivatedRoute,
    NavigationEnd,
    Router,
} from '@angular/router';
import { Store } from '@ngrx/store';
import { PlaylistActions } from 'm3u-state';
import { filter } from 'rxjs';
import {
    PortalRailSection,
    resolveCurrentPortalPlaylistId,
    resolveCurrentPortalSection,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';

@Injectable()
export class XtreamWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly xtreamStore = inject(XtreamStore);

    private currentPlaylistId: string | null = null;

    constructor() {
        this.router.events
            .pipe(
                filter(
                    (event): event is NavigationEnd =>
                        event instanceof NavigationEnd
                ),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => {
                void this.syncRouteContext();
            });

        void this.syncRouteContext();
    }

    private async syncRouteContext(): Promise<void> {
        const playlistId = resolveCurrentPortalPlaylistId(
            this.route,
            this.router.url,
            'xtreams'
        );

        if (playlistId && this.currentPlaylistId !== playlistId) {
            this.xtreamStore.resetStore(playlistId);
            this.currentPlaylistId = playlistId;

            this.store.dispatch(
                PlaylistActions.setActivePlaylist({ playlistId })
            );

            await this.xtreamStore.fetchXtreamPlaylist();
            await this.xtreamStore.checkPortalStatus();
        }

        const section = this.syncRouteState();
        await this.initializeCurrentSectionContent(section);
    }

    private syncRouteState(): PortalRailSection | null {
        const section = resolveCurrentPortalSection(
            this.route,
            this.router.url,
            'xtreams'
        );

        if (!section) {
            return null;
        }

        if (section === 'vod' || section === 'live' || section === 'series') {
            this.xtreamStore.setSelectedContentType(section);
        }

        return section;
    }

    private async initializeCurrentSectionContent(
        section: PortalRailSection | null
    ): Promise<void> {
        const playlist = this.xtreamStore.currentPlaylist();
        const playlistId = this.xtreamStore.playlistId();

        if (!playlist || playlist.id !== playlistId) {
            return;
        }

        if (
            section === 'vod' ||
            section === 'live' ||
            section === 'series' ||
            section === 'search' ||
            section === 'recently-added'
        ) {
            await this.xtreamStore.initializeContent();
        }
    }
}

export function provideXtreamWorkspaceRouteSession(): Provider[] {
    return [
        XtreamWorkspaceRouteSession,
        {
            provide: ENVIRONMENT_INITIALIZER,
            multi: true,
            useValue: () => {
                inject(XtreamWorkspaceRouteSession);
            },
        },
    ];
}
