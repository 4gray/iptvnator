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
import { ChannelActions, FavoritesActions } from 'm3u-state';
import { filter, firstValueFrom } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PlaylistsService } from 'services';

type M3uLoadedSection = 'all' | 'groups';

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
            this.store.dispatch(
                ChannelActions.setChannelsLoading({ loading: false })
            );
            return;
        }

        if (!playlistChanged && !enteringLoadedSection) {
            return;
        }

        const requestId = ++this.loadRequestId;
        this.store.dispatch(ChannelActions.setChannelsLoading({ loading: true }));

        try {
            const playlist = await firstValueFrom(
                this.playlistsService.getPlaylist(playlistId)
            );

            if (!this.isCurrentLoadRequest(requestId, playlistId, section)) {
                return;
            }

            if (playlist.userAgent) {
                window.electron?.setUserAgent(playlist.userAgent, 'localhost');
            }

            this.store.dispatch(
                ChannelActions.setChannels({
                    channels: playlist.playlist?.items ?? [],
                })
            );

            const favorites = (playlist.favorites ?? []).filter(
                (favorite): favorite is string => typeof favorite === 'string'
            );
            this.store.dispatch(
                FavoritesActions.setFavorites({
                    channelIds: favorites,
                })
            );
        } catch {
            if (!this.isCurrentLoadRequest(requestId, playlistId, section)) {
                return;
            }

            this.store.dispatch(ChannelActions.setChannels({ channels: [] }));
            this.store.dispatch(
                FavoritesActions.setFavorites({ channelIds: [] })
            );
        }
    }

    private isLoadedSection(section: string | null): section is M3uLoadedSection {
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
