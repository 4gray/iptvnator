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

function hasPlaylistConnectionChanges(
    currentPlaylist: XtreamPlaylistData | null,
    nextPlaylist: XtreamPlaylistData | null
): boolean {
    if (!currentPlaylist || !nextPlaylist) {
        return false;
    }

    const currentUserAgent = currentPlaylist.userAgent ?? null;
    const nextUserAgent = nextPlaylist.userAgent ?? null;
    const currentReferrer = currentPlaylist.referrer ?? null;
    const nextReferrer = nextPlaylist.referrer ?? null;
    const currentOrigin = currentPlaylist.origin ?? null;
    const nextOrigin = nextPlaylist.origin ?? null;

    return (
        currentPlaylist.serverUrl !== nextPlaylist.serverUrl ||
        currentPlaylist.username !== nextPlaylist.username ||
        currentPlaylist.password !== nextPlaylist.password ||
        currentUserAgent !== nextUserAgent ||
        currentReferrer !== nextReferrer ||
        currentOrigin !== nextOrigin
    );
}

function shouldBootstrapXtreamPlaylist(
    playlistId: string | null,
    routePlaylist: XtreamPlaylistData | null,
    storePlaylistId: string | null,
    currentPlaylist: XtreamPlaylistData | null
): boolean {
    const currentPlaylistUpdateDate = currentPlaylist?.updateDate ?? null;
    const routePlaylistUpdateDate = routePlaylist?.updateDate ?? null;

    return Boolean(
        playlistId &&
            routePlaylist &&
            (storePlaylistId !== playlistId ||
                currentPlaylist?.id !== playlistId ||
                currentPlaylistUpdateDate !== routePlaylistUpdateDate ||
                hasPlaylistConnectionChanges(currentPlaylist, routePlaylist))
    );
}

function getXtreamRouteCategoryId(
    url: string,
    section: PortalRailSection | null
): number | null {
    if (
        section !== 'live' &&
        section !== 'vod' &&
        section !== 'series'
    ) {
        return null;
    }

    const path = url.split('?')[0] ?? '';
    const segments = path.split('/').filter(Boolean);
    const categorySegment = segments[4];

    if (!categorySegment) {
        return null;
    }

    const categoryId = Number(categorySegment);
    return Number.isNaN(categoryId) ? null : categoryId;
}

@Injectable()
export class XtreamWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);

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
        const routeSection =
            routeContext.provider === 'xtreams' ? routeContext.section : null;
        const routePlaylist =
            routeContext.provider === 'xtreams'
                ? toXtreamPlaylistData(this.playlistContext.activePlaylist())
                : null;
        const storePlaylistId = this.xtreamStore.playlistId();
        const currentPlaylist = this.xtreamStore.currentPlaylist();
        const shouldBootstrapPlaylist = shouldBootstrapXtreamPlaylist(
            playlistId,
            routePlaylist,
            storePlaylistId,
            currentPlaylist
        );
        let portalStatus = this.xtreamStore.portalStatus();
        let didBootstrapPlaylist = false;

        if (playlistId && shouldBootstrapPlaylist) {
            this.xtreamStore.resetStore(playlistId);
            didBootstrapPlaylist = true;

            this.xtreamStore.setCurrentPlaylist(routePlaylist);

            await this.xtreamStore.fetchXtreamPlaylist();
            portalStatus = await this.xtreamStore.checkPortalStatus();
            const hasUsableOfflineCache =
                portalStatus === 'unavailable'
                    ? await this.xtreamStore.hasUsableOfflineCache()
                    : false;
            const nextBlockReason =
                portalStatus === 'unavailable' && hasUsableOfflineCache
                    ? null
                    : toContentInitBlockReason(portalStatus);
            const currentBlockReason =
                this.xtreamStore.contentInitBlockReason();

            if (
                nextBlockReason !== null ||
                currentBlockReason !== 'cancelled'
            ) {
                this.xtreamStore.setContentInitBlockReason(nextBlockReason);
            }
        }

        const section = this.syncRouteState(routeSection);

        const canUseOfflineCache =
            portalStatus === 'unavailable'
                ? await this.xtreamStore.hasUsableOfflineCache()
                : false;

        if (
            isImportDrivenSection(section) &&
            portalStatus !== 'active' &&
            !canUseOfflineCache
        ) {
            return;
        }

        await this.initializeCurrentSectionContent(
            section,
            didBootstrapPlaylist
        );
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

        this.xtreamStore.setSelectedCategory(
            getXtreamRouteCategoryId(this.router.url, section)
        );

        return section;
    }

    private async initializeCurrentSectionContent(
        section: PortalRailSection | null,
        didBootstrapPlaylist: boolean
    ): Promise<void> {
        const playlist = this.xtreamStore.currentPlaylist();
        const playlistId = this.xtreamStore.playlistId();

        if (!playlist || playlist.id !== playlistId) {
            return;
        }

        if (
            isImportDrivenSection(section) &&
            (didBootstrapPlaylist || !this.xtreamStore.isContentInitialized())
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
