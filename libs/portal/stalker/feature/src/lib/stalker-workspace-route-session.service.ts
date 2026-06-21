import {
    DestroyRef,
    ENVIRONMENT_INITIALIZER,
    inject,
    Injectable,
    Provider,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PortalRailSection } from '@iptvnator/portal/shared/util';
import {
    StalkerContentType,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';

@Injectable()
export class StalkerWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly router = inject(Router);
    private readonly stalkerStore = inject(StalkerStore);

    private currentPlaylistId: string | null = null;
    private readonly currentSection = signal<PortalRailSection | null>(null);

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

        this.destroyRef.onDestroy(() => {
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();
        });
    }

    private async syncRouteContext(): Promise<void> {
        const routeContext = this.playlistContext.syncFromUrl(this.router.url);
        const playlistId =
            routeContext.provider === 'stalker'
                ? routeContext.playlistId
                : null;

        if (playlistId && this.currentPlaylistId !== playlistId) {
            this.currentPlaylistId = playlistId;

            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();

            const playlist = await this.resolveStalkerPlaylist(playlistId);
            await this.stalkerStore.setCurrentPlaylist(playlist);
        }

        this.syncRouteState(routeContext.section);
    }

    private syncRouteState(section: PortalRailSection | null): void {
        if (!section) {
            return;
        }

        const previousSection = this.currentSection();

        if (section !== previousSection) {
            this.currentSection.set(section);
        }

        if (
            section === 'vod' ||
            section === 'series' ||
            section === 'itv' ||
            section === 'radio'
        ) {
            this.stalkerStore.setSelectedContentType(
                section as StalkerContentType
            );
        }

        if (
            (section === 'itv' || section === 'radio') &&
            previousSection !== section
        ) {
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();
            this.stalkerStore.setSearchPhrase('');
        }
    }

    private async resolveStalkerPlaylist(
        playlistId: string
    ): Promise<PlaylistMeta | undefined> {
        const activePlaylist = this.playlistContext.activePlaylist();

        if (this.hasExplicitStalkerPortalMode(playlistId, activePlaylist)) {
            return activePlaylist;
        }

        const storedPlaylist = await firstValueFrom(
            this.playlistsService.getPlaylistById(playlistId),
            { defaultValue: null }
        );

        return storedPlaylist ?? activePlaylist ?? undefined;
    }

    private hasExplicitStalkerPortalMode(
        playlistId: string,
        playlist: PlaylistMeta | null
    ): playlist is PlaylistMeta {
        return (
            playlist?._id === playlistId &&
            playlist.isFullStalkerPortal !== undefined
        );
    }
}

export function provideStalkerWorkspaceRouteSession(): Provider[] {
    return [
        StalkerWorkspaceRouteSession,
        {
            provide: ENVIRONMENT_INITIALIZER,
            multi: true,
            useValue: () => {
                inject(StalkerWorkspaceRouteSession);
            },
        },
    ];
}
