import {
    DestroyRef,
    ENVIRONMENT_INITIALIZER,
    effect,
    inject,
    Injectable,
    Provider,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PortalRailSection } from '@iptvnator/portal/shared/util';
import {
    XtreamCachedContentScope,
    PortalStatusType,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { SourceActivityService } from '@iptvnator/services';
import {
    toXtreamPlaylistData,
    shouldBootstrapXtreamPlaylist,
} from './xtream-route-playlist';

/**
 * Sections whose content comes from the imported catalog, so a cold load
 * of one has to initialize it first.
 *
 * The parameter is a raw URL segment, not a rail section: `actor` and
 * `discover` have no rail entry, yet both read the catalog to decide
 * whether a TMDB title is "In your library". Without initialization a
 * direct load of either answers "no" for everything the user owns —
 * a wrong claim rather than a missing one.
 */
function isImportDrivenSection(section: string | null): boolean {
    return (
        section === 'vod' ||
        section === 'live' ||
        section === 'series' ||
        section === 'search' ||
        section === 'recently-added' ||
        section === 'actor' ||
        section === 'discover'
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
    section: string | null
): XtreamCachedContentScope | null {
    switch (section) {
        case 'live':
        case 'vod':
        case 'series':
        case 'search':
        case 'recently-added':
            return section;
        // Neither reads one content type: both match TMDB titles against
        // the whole catalog, so they take the aggregate scope search uses.
        // Without it an expired or offline portal skips hydration and the
        // page answers "not in your library" from an empty catalog.
        case 'actor':
        case 'discover':
            return 'search';
        default:
            return null;
    }
}

function getXtreamRouteTarget(url: string): {
    playlistId: string | null;
    section: PortalRailSection | null;
} {
    const match = url.match(/^\/workspace\/xtreams\/([^/?]+)(?:\/([^/?]+))?/);

    return {
        playlistId: match?.[1] ?? null,
        section: (match?.[2] as PortalRailSection | undefined) ?? null,
    };
}

function getXtreamRouteCategoryId(
    url: string,
    section: PortalRailSection | null
): number | null {
    if (section !== 'live' && section !== 'vod' && section !== 'series') {
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
    private readonly activity = inject(SourceActivityService);
    /** Sources this sync loop holds busy, released when the loop settles. */
    private readonly heldSources = new Map<string, () => void>();

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
        this.holdRoutedSource();
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
                this.heldSources.forEach((release) => release());
                this.heldSources.clear();
            }
        })();
    }

    /**
     * Holds the routed source busy from the moment its route is reached
     * until the sync, and the import it awaits, settle. An Xtream refresh
     * releases its own hold when its navigation ends, and this one is taken
     * on that NavigationEnd, so removal never sees the source idle between
     * the catalog delete and the re-import.
     */
    private holdRoutedSource(): void {
        const playlistId = getXtreamRouteTarget(this.router.url).playlistId;
        if (playlistId && !this.heldSources.has(playlistId)) {
            this.heldSources.set(playlistId, this.activity.begin([playlistId]));
        }
    }

    private async syncRouteContext(): Promise<void> {
        const url = this.router.url;
        const targetId = getXtreamRouteTarget(url).playlistId;
        // Shared metadata can publish during an edit-time scan. Keep our own
        // cleanup hold, but wait before resetting the store or reading a cache
        // whose importing marker still belongs to that live scan.
        if (targetId && untracked(() => this.activity.isBusy(targetId, 1))) {
            const { waitForSourceIdle } =
                await import('./xtream-route-activity-idle');
            await waitForSourceIdle(this.activity, targetId, 1);
        }
        if (this.destroyRef.destroyed || this.router.url !== url) return;
        // Read the latest playlist after waiting; navigation queues a new pass.
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
        if (
            !shouldBootstrapPlaylist &&
            currentPlaylist &&
            routePlaylist &&
            (currentPlaylist.name !== routePlaylist.name ||
                currentPlaylist.title !== routePlaylist.title)
        ) {
            this.xtreamStore.setCurrentPlaylist({
                ...currentPlaylist,
                name: routePlaylist.name,
                title: routePlaylist.title,
            });
        }
        const cacheScope = toCachedContentScope(routeSection);
        let portalStatus = this.xtreamStore.portalStatus();
        let didBootstrapPlaylist = false;
        let canUseCachedContent = false;
        let section = routeSection;

        if (playlistId && shouldBootstrapPlaylist) {
            this.xtreamStore.resetStore(playlistId);
            didBootstrapPlaylist = true;

            this.xtreamStore.setCurrentPlaylist(routePlaylist);
            this.xtreamStore.reconcilePendingRestoreBlock();
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
            const nextBlockReason = canUseCachedContent
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

        if (portalStatus !== 'active' && !canUseCachedContent && cacheScope) {
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
