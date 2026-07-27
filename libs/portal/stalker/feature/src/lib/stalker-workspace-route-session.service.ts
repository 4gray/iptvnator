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
import { Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerConnectionFlowService } from './stalker-connection-flow/stalker-connection-flow.service';

@Injectable()
export class StalkerWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly connectionFlow = inject(StalkerConnectionFlowService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly router = inject(Router);
    private readonly stalkerStore = inject(StalkerStore);

    private currentPlaylistId: string | null = null;
    private readonly currentSection = signal<PortalRailSection | null>(null);
    private syncGeneration = 0;

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
        this.connectionFlow.connectionReady$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((playlist) => {
                if (playlist._id === this.currentPlaylistId) {
                    void this.stalkerStore.setCurrentPlaylist(playlist);
                }
            });

        void this.syncRouteContext();

        this.destroyRef.onDestroy(() => {
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();
        });
    }

    private async syncRouteContext(): Promise<void> {
        const generation = ++this.syncGeneration;
        const routeContext = this.playlistContext.syncFromUrl(this.router.url);
        const playlistId =
            routeContext.provider === 'stalker'
                ? routeContext.playlistId
                : null;

        if (!playlistId && this.currentPlaylistId !== null) {
            this.currentPlaylistId = null;
            await this.connectionFlow.cancel();
            if (generation !== this.syncGeneration) {
                return;
            }
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();
            await this.stalkerStore.setCurrentPlaylist(undefined);
        } else if (playlistId && this.currentPlaylistId !== playlistId) {
            if (this.currentPlaylistId !== null) {
                await this.connectionFlow.cancel();
            }
            this.currentPlaylistId = playlistId;

            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();

            const playlist = await this.resolveStalkerPlaylist(playlistId);
            const connected =
                playlist === undefined
                    ? undefined
                    : await this.connectionFlow.ensureConnected(
                          playlist as Playlist
                      );
            if (
                generation !== this.syncGeneration ||
                playlistId !== this.currentPlaylistId
            ) {
                return;
            }
            if (connected !== undefined) {
                await this.stalkerStore.setCurrentPlaylist(connected);
            }
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
        StalkerConnectionFlowService,
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
