import {
    DestroyRef,
    ENVIRONMENT_INITIALIZER,
    effect,
    inject,
    Injectable,
    Provider,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PortalRailSection } from '@iptvnator/portal/shared/util';
import {
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { PlaylistMeta } from 'shared-interfaces';

function toXtreamPlaylistData(
    playlist: PlaylistMeta | null
): XtreamPlaylistData | null {
    if (
        !playlist?._id ||
        !playlist.serverUrl ||
        !playlist.username ||
        !playlist.password
    ) {
        return null;
    }

    return {
        id: playlist._id,
        name: playlist.title || playlist.filename || 'Untitled playlist',
        title: playlist.title,
        serverUrl: playlist.serverUrl,
        username: playlist.username,
        password: playlist.password,
        type: 'xtream',
        userAgent: playlist.userAgent,
        referrer: playlist.referrer,
        origin: playlist.origin,
    };
}

@Injectable()
export class XtreamWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);

    private currentPlaylistId: string | null = null;

    constructor() {
        effect(() => {
            const routeProvider = this.playlistContext.routeProvider();
            const routePlaylistId = this.playlistContext.routePlaylistId();
            const activePlaylist = this.playlistContext.activePlaylist();

            if (
                routeProvider !== 'xtreams' ||
                !routePlaylistId ||
                activePlaylist?._id !== routePlaylistId
            ) {
                return;
            }

            void this.syncRouteContext();
        });

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
            routeContext.provider === 'xtreams'
                ? routeContext.playlistId
                : null;
        const routePlaylist =
            routeContext.provider === 'xtreams'
                ? toXtreamPlaylistData(this.playlistContext.activePlaylist())
                : null;
        const currentPlaylist = this.xtreamStore.currentPlaylist();
        const needsPlaylistBootstrap = Boolean(
            playlistId &&
                routePlaylist &&
                currentPlaylist?.id !== playlistId
        );

        if (
            playlistId &&
            (this.currentPlaylistId !== playlistId || needsPlaylistBootstrap)
        ) {
            if (this.currentPlaylistId !== playlistId) {
                this.xtreamStore.resetStore(playlistId);
                this.currentPlaylistId = playlistId;
            }

            this.xtreamStore.setCurrentPlaylist(routePlaylist);

            await this.xtreamStore.fetchXtreamPlaylist();
            await this.xtreamStore.checkPortalStatus();
        }

        const section = this.syncRouteState(routeContext.section);
        await this.initializeCurrentSectionContent(section);
    }

    private syncRouteState(
        section: PortalRailSection | null
    ): PortalRailSection | null {
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
