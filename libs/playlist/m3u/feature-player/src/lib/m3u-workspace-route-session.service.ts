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
import { ChannelActions, FavoritesActions } from '@iptvnator/m3u-state';
import {
    measureRendererPerformancePhase,
    RENDERER_PERFORMANCE_PHASE,
} from '@iptvnator/shared/logging';
import { filter, firstValueFrom } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PlaylistsService } from '@iptvnator/services';

type M3uLoadedSection = 'all' | 'groups' | 'vod' | 'series';

@Injectable()
export class M3uWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly router = inject(Router);
    private readonly store = inject(Store);

    private currentPlaylistId: string | null = null;
    private currentSection: string | null = null;
    private loadRequestId = 0;

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
            // A section that does not read the channel array leaves the
            // previous playlist's rows behind. Nothing here consumes them,
            // but the shell rail counts the catalog from them and would
            // offer this playlist Movies/Series it does not have. The next
            // loaded section reloads anyway, because the playlist changed.
            this.store.dispatch(
                playlistChanged
                    ? ChannelActions.setChannels({ channels: [] })
                    : ChannelActions.setChannelsLoading({ loading: false })
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

        try {
            const playlist = await firstValueFrom(
                this.playlistsService.getPlaylist(playlistId)
            );

            if (!this.isCurrentLoadRequest(requestId, playlistId)) {
                return;
            }

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
                            playlistId,
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
            if (!this.isCurrentLoadRequest(requestId, playlistId)) {
                return;
            }

            this.store.dispatch(ChannelActions.setChannels({ channels: [] }));
            this.store.dispatch(
                FavoritesActions.hydrateFavorites({ channelIds: [] })
            );
        }
    }

    private isLoadedSection(
        section: string | null
    ): section is M3uLoadedSection {
        return (
            section === 'all' ||
            section === 'groups' ||
            section === 'vod' ||
            section === 'series'
        );
    }

    private isCurrentLoadRequest(
        requestId: number,
        playlistId: string
    ): boolean {
        // Not "still on the SAME section": the loaded sections share one
        // load, so moving from All channels to Movies while it is in flight
        // starts no new request, and rejecting the response for the section
        // it was asked from would leave the playlist loading forever.
        // Leaving the loaded sections bumps `loadRequestId`.
        return (
            requestId === this.loadRequestId &&
            this.currentPlaylistId === playlistId &&
            this.isLoadedSection(this.currentSection)
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
