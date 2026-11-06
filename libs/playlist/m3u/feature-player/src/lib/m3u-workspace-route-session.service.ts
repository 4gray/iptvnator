import {
    DestroyRef,
    ENVIRONMENT_INITIALIZER,
    inject,
    Injectable,
    Provider,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import {
    ChannelActions,
    FavoritesActions,
    PlaylistActions,
    selectPlaylistEntities,
} from '@iptvnator/m3u-state';
import {
    measureRendererPerformancePhase,
    RENDERER_PERFORMANCE_PHASE,
} from '@iptvnator/shared/logging';
import { filter, firstValueFrom, map, Subscription, take } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PlaylistsService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';

type M3uLoadedSection = 'all' | 'groups';

@Injectable()
export class M3uWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly playlistEntities = this.store.selectSignal(
        selectPlaylistEntities
    );

    private currentPlaylistId: string | null = null;
    private currentSection: string | null = null;
    private loadRequestId = 0;
    private pendingHiddenGroupsHydration: Subscription | null = null;

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
        const routeContext = this.playlistContext.syncFromUrl(this.router.url);
        const playlistId =
            routeContext.provider === 'playlists'
                ? routeContext.playlistId
                : null;
        const section =
            routeContext.provider === 'playlists' ? routeContext.section : null;
        const previousSection = this.currentSection;
        this.currentSection = section;
        const playlistChanged = playlistId !== this.currentPlaylistId;
        const shouldLoadPlaylist = this.isLoadedSection(section);
        const enteringLoadedSection =
            shouldLoadPlaylist && !this.isLoadedSection(previousSection);

        if (!playlistId) {
            this.currentPlaylistId = null;
            this.loadRequestId += 1;
            this.store.dispatch(
                ChannelActions.setChannelsLoading({ loading: false })
            );
            return;
        }

        if (playlistChanged) {
            this.currentPlaylistId = playlistId;
            this.store.dispatch(ChannelActions.resetActiveChannel());
        }

        if (!shouldLoadPlaylist) {
            this.loadRequestId += 1;
            this.store.dispatch(
                ChannelActions.setChannelsLoading({ loading: false })
            );
            return;
        }

        if (!playlistChanged && !enteringLoadedSection) {
            return;
        }

        const requestId = ++this.loadRequestId;
        this.store.dispatch(
            ChannelActions.setChannelsLoading({ loading: true })
        );

        const hiddenGroupTitlesBeforeRead =
            this.playlistEntities()[playlistId]?.hiddenGroupTitles;

        try {
            const playlist = await firstValueFrom(
                this.playlistsService.getPlaylist(playlistId)
            );

            if (!this.isCurrentLoadRequest(requestId, playlistId, section)) {
                return;
            }

            this.hydrateHiddenGroupTitles(
                playlistId,
                playlist.hiddenGroupTitles,
                hiddenGroupTitlesBeforeRead
            );

            void window.electron
                ?.setUserAgent(playlist.userAgent, playlist.referrer)
                .catch((error: unknown) => {
                    console.warn(
                        '[M3uWorkspaceRouteSession] Failed to configure Electron request headers:',
                        error
                    );
                });

            const channels = playlist.playlist?.items ?? [];
            measureRendererPerformancePhase(
                RENDERER_PERFORMANCE_PHASE.M3U_PUBLISH_CHANNELS,
                () =>
                    this.store.dispatch(
                        ChannelActions.setChannels({
                            channels,
                        })
                    ),
                () => ({ items: channels.length })
            );

            const favorites = (playlist.favorites ?? []).filter(
                (favorite): favorite is string => typeof favorite === 'string'
            );
            this.store.dispatch(
                FavoritesActions.hydrateFavorites({
                    channelIds: favorites,
                })
            );
        } catch {
            if (!this.isCurrentLoadRequest(requestId, playlistId, section)) {
                return;
            }

            this.store.dispatch(ChannelActions.setChannels({ channels: [] }));
            this.store.dispatch(
                FavoritesActions.hydrateFavorites({ channelIds: [] })
            );
        }
    }

    /**
     * Electron's startup playlist list reads the metadata columns only, which
     * leave out the hidden groups stored in the payload (#1894). Published
     * before the channels so the groups rail never shows them; a save made
     * while the read was queued is newer and stays.
     *
     * A restored or deep-linked route can finish this read before the startup
     * inventory publishes the playlist (that waits for settings and EPG
     * reconciliation), and `updateOne` drops an update for a missing entity,
     * so the hydration waits for it.
     */
    private hydrateHiddenGroupTitles(
        playlistId: string,
        storedHiddenGroupTitles: string[] | undefined,
        hiddenGroupTitlesBeforeRead: string[] | undefined
    ): void {
        this.pendingHiddenGroupsHydration?.unsubscribe();
        this.pendingHiddenGroupsHydration = this.store
            .select(selectPlaylistEntities)
            .pipe(
                map((entities) => entities[playlistId]),
                filter((playlist) => playlist !== undefined),
                take(1),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe((playlist) => {
                if (
                    playlist.hiddenGroupTitles !== hiddenGroupTitlesBeforeRead
                ) {
                    return;
                }
                this.store.dispatch(
                    PlaylistActions.updatePlaylistMeta({
                        playlist: {
                            _id: playlistId,
                            hiddenGroupTitles: storedHiddenGroupTitles ?? [],
                        } as PlaylistMeta,
                        persist: false,
                    })
                );
            });
    }

    private isLoadedSection(
        section: string | null
    ): section is M3uLoadedSection {
        return section === 'all' || section === 'groups';
    }

    private isCurrentLoadRequest(
        requestId: number,
        playlistId: string,
        section: M3uLoadedSection
    ): boolean {
        return (
            requestId === this.loadRequestId &&
            this.currentPlaylistId === playlistId &&
            this.currentSection === section
        );
    }
}

export function provideM3uWorkspaceRouteSession(): Provider[] {
    return [
        M3uWorkspaceRouteSession,
        {
            provide: ENVIRONMENT_INITIALIZER,
            multi: true,
            useValue: () => {
                inject(M3uWorkspaceRouteSession);
            },
        },
    ];
}
