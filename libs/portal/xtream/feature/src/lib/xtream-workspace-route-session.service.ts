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
    PortalStatusType,
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
        updateDate: playlist.updateDate,
        serverUrl: playlist.serverUrl,
        username: playlist.username,
        password: playlist.password,
        type: 'xtream',
        userAgent: playlist.userAgent,
        referrer: playlist.referrer,
        origin: playlist.origin,
    };
}

function isImportDrivenSection(section: PortalRailSection | null): boolean {
    return (
        section === 'vod' ||
        section === 'live' ||
        section === 'series' ||
        section === 'search' ||
        section === 'recently-added'
    );
}

function toContentInitBlockReason(
    portalStatus: PortalStatusType
): 'expired' | 'inactive' | 'unavailable' | null {
    switch (portalStatus) {
        case 'expired':
        case 'inactive':
        case 'unavailable':
            return portalStatus;
        default:
            return null;
    }
}

@Injectable()
export class XtreamWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);

    private currentPlaylistId: string | null = null;
    private currentPlaylistUpdateDate: number | null = null;
    private syncInFlight = false;
    private syncPending = false;

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

            this.scheduleSyncRouteContext();
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
                this.scheduleSyncRouteContext();
            });

        this.scheduleSyncRouteContext();
    }

    private scheduleSyncRouteContext(): void {
        if (this.syncInFlight) {
            this.syncPending = true;
            return;
        }

        this.syncInFlight = true;

        void (async () => {
            try {
                do {
                    this.syncPending = false;
                    await this.syncRouteContext();
                } while (this.syncPending);
            } finally {
                this.syncInFlight = false;
            }
        })();
    }

    private async syncRouteContext(): Promise<void> {
        const routeContext = this.playlistContext.syncFromUrl(this.router.url);
        const playlistId =
            routeContext.provider === 'xtreams'
                ? routeContext.playlistId
                : null;
        const section = this.syncRouteState(routeContext.section);
        const routePlaylist =
            routeContext.provider === 'xtreams'
                ? toXtreamPlaylistData(this.playlistContext.activePlaylist())
                : null;
        const currentPlaylist = this.xtreamStore.currentPlaylist();
        const routePlaylistUpdateDate = routePlaylist?.updateDate ?? null;
        const needsPlaylistBootstrap = Boolean(
            playlistId &&
                routePlaylist &&
                (currentPlaylist?.id !== playlistId ||
                    this.currentPlaylistUpdateDate !== routePlaylistUpdateDate)
        );
        let portalStatus = this.xtreamStore.portalStatus();

        if (
            playlistId &&
            (this.currentPlaylistId !== playlistId || needsPlaylistBootstrap)
        ) {
            if (this.currentPlaylistId !== playlistId || needsPlaylistBootstrap) {
                this.xtreamStore.resetStore(playlistId);
                this.currentPlaylistId = playlistId;
                this.currentPlaylistUpdateDate = routePlaylistUpdateDate;
            }

            this.xtreamStore.setCurrentPlaylist(routePlaylist);

            await this.xtreamStore.fetchXtreamPlaylist();
            portalStatus = await this.xtreamStore.checkPortalStatus();
            const nextBlockReason = toContentInitBlockReason(portalStatus);
            const currentBlockReason =
                this.xtreamStore.contentInitBlockReason();

            if (
                nextBlockReason !== null ||
                currentBlockReason !== 'cancelled'
            ) {
                this.xtreamStore.setContentInitBlockReason(nextBlockReason);
            }
        }

        if (isImportDrivenSection(section) && portalStatus !== 'active') {
            return;
        }

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
            isImportDrivenSection(section)
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
