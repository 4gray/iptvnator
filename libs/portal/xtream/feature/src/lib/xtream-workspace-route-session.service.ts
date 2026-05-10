import {
    DestroyRef,
    ENVIRONMENT_INITIALIZER,
    effect,
    inject,
    Injectable,
    Provider,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PortalRailSection } from '@iptvnator/portal/shared/util';
import {
    XtreamCachedContentScope,
    PortalStatusType,
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { PlaylistMeta } from 'shared-interfaces';

function normalizeOptionalConnectionValue(
    value: string | null | undefined
): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

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

    const userAgent = normalizeOptionalConnectionValue(playlist.userAgent);
    const referrer = normalizeOptionalConnectionValue(playlist.referrer);
    const origin = normalizeOptionalConnectionValue(playlist.origin);

    return {
        id: playlist._id,
        name: playlist.title || playlist.filename || 'Untitled playlist',
        title: playlist.title,
        updateDate: playlist.updateDate,
        serverUrl: playlist.serverUrl,
        username: playlist.username,
        password: playlist.password,
        type: 'xtream',
        ...(userAgent ? { userAgent } : {}),
        ...(referrer ? { referrer } : {}),
        ...(origin ? { origin } : {}),
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

function toCachedContentScope(
    section: PortalRailSection | null
): XtreamCachedContentScope | null {
    switch (section) {
        case 'live':
        case 'vod':
        case 'series':
        case 'search':
        case 'recently-added':
            return section;
        default:
            return null;
    }
}

function getXtreamRouteTarget(url: string): {
    playlistId: string | null;
    section: PortalRailSection | null;
} {
    const match = url.match(
        /^\/workspace\/xtreams\/([^/?]+)(?:\/([^/?]+))?/
    );

    return {
        playlistId: match?.[1] ?? null,
        section: (match?.[2] as PortalRailSection | undefined) ?? null,
    };
}

function hasPlaylistConnectionChanges(
    currentPlaylist: XtreamPlaylistData | null,
    nextPlaylist: XtreamPlaylistData | null
): boolean {
    if (!currentPlaylist || !nextPlaylist) {
        return false;
    }

    const currentUserAgent = normalizeOptionalConnectionValue(
        currentPlaylist.userAgent
    );
    const nextUserAgent = normalizeOptionalConnectionValue(
        nextPlaylist.userAgent
    );
    const currentReferrer = normalizeOptionalConnectionValue(
        currentPlaylist.referrer
    );
    const nextReferrer = normalizeOptionalConnectionValue(nextPlaylist.referrer);
    const currentOrigin = normalizeOptionalConnectionValue(
        currentPlaylist.origin
    );
    const nextOrigin = normalizeOptionalConnectionValue(nextPlaylist.origin);

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

function getRoutePath(url: string): string {
    return url.split('?')[0] ?? url;
}

@Injectable()
export class XtreamWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);

    private syncInFlight = false;
    private syncPending = false;
    private lastSyncedRoutePath: string | null = null;

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
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((event) => {
                if (event instanceof NavigationStart) {
                    this.prepareTargetPlaylistLoading(event.url);
                }

                if (event instanceof NavigationEnd) {
                    this.scheduleSyncRouteContext();
                }
            });

        this.scheduleSyncRouteContext();
    }

    private prepareTargetPlaylistLoading(url: string): void {
        const target = getXtreamRouteTarget(url);

        if (
            !target.playlistId ||
            target.playlistId === this.xtreamStore.playlistId() ||
            !isImportDrivenSection(target.section)
        ) {
            return;
        }

        this.xtreamStore.prepareContentLoading(
            toCachedContentScope(target.section)
        );
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
        const cacheScope = toCachedContentScope(routeSection);
        let portalStatus = this.xtreamStore.portalStatus();
        let didBootstrapPlaylist = false;
        let canUseCachedContent = false;
        let section = routeSection;

        if (playlistId && shouldBootstrapPlaylist) {
            this.xtreamStore.resetStore(playlistId);
            didBootstrapPlaylist = true;

            this.xtreamStore.setCurrentPlaylist(routePlaylist);
            section = this.syncRouteState(routeSection);
            if (isImportDrivenSection(section)) {
                this.xtreamStore.prepareContentLoading(cacheScope);
            }

            await this.xtreamStore.fetchXtreamPlaylist();
            portalStatus = await this.xtreamStore.checkPortalStatus();
            canUseCachedContent =
                portalStatus !== 'active' && cacheScope
                    ? this.xtreamStore.isCachedContentScopeReady(cacheScope) ||
                      (await this.xtreamStore.hasUsableOfflineCache(cacheScope))
                    : false;
            const nextBlockReason =
                canUseCachedContent
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

        if (!didBootstrapPlaylist) {
            section = this.syncRouteState(routeSection);
        }

        if (
            portalStatus !== 'active' &&
            !canUseCachedContent &&
            cacheScope
        ) {
            canUseCachedContent =
                this.xtreamStore.isCachedContentScopeReady(cacheScope) ||
                (await this.xtreamStore.hasUsableOfflineCache(cacheScope));
        }

        if (
            isImportDrivenSection(section) &&
            portalStatus !== 'active' &&
            !canUseCachedContent
        ) {
            return;
        }

        await this.initializeCurrentSectionContent(
            section,
            didBootstrapPlaylist,
            canUseCachedContent,
            cacheScope
        );
    }

    private syncRouteState(
        section: PortalRailSection | null
    ): PortalRailSection | null {
        if (!section) {
            return null;
        }

        const routePath = getRoutePath(this.router.url);
        const isQueryOnlyNavigation = this.lastSyncedRoutePath === routePath;
        this.lastSyncedRoutePath = routePath;

        if (section === 'vod' || section === 'live' || section === 'series') {
            this.xtreamStore.setSelectedContentType(section);
        }

        const routeCategoryId = getXtreamRouteCategoryId(
            this.router.url,
            section
        );
        if (
            section === 'live' &&
            routeCategoryId === null &&
            isQueryOnlyNavigation
        ) {
            return section;
        }

        this.xtreamStore.setSelectedCategory(routeCategoryId);

        return section;
    }

    private async initializeCurrentSectionContent(
        section: PortalRailSection | null,
        didBootstrapPlaylist: boolean,
        canUseCachedContent: boolean,
        cacheScope: XtreamCachedContentScope | null
    ): Promise<void> {
        const playlist = this.xtreamStore.currentPlaylist();
        const playlistId = this.xtreamStore.playlistId();

        if (!playlist || playlist.id !== playlistId) {
            return;
        }

        if (isImportDrivenSection(section) && canUseCachedContent) {
            if (
                cacheScope &&
                !this.xtreamStore.isCachedContentScopeReady(cacheScope)
            ) {
                await this.xtreamStore.hydrateCachedContent(cacheScope);
            }
            return;
        }

        const sectionLoadState =
            section === 'live' || section === 'vod' || section === 'series'
                ? this.xtreamStore.contentLoadStateByType()[section]
                : null;

        if (
            isImportDrivenSection(section) &&
            (didBootstrapPlaylist ||
                !this.xtreamStore.isContentInitialized() ||
                sectionLoadState !== 'ready')
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
