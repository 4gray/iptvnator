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
    private readonly synced = signal(false);

    /**
     * Arrivals are applied one at a time, and only the newest one publishes
     * readiness. Both halves are load-bearing: the constructor starts a sync
     * before the first `NavigationEnd` starts another, so two can be in
     * flight at once, and the playlist id is claimed only once the store
     * actually holds that row — otherwise the second sync saw the id already
     * claimed, skipped the bootstrap, and reported ready while the first was
     * still awaiting `setCurrentPlaylist()`, leaving the auto-open handoff to
     * resolve and play against the PREVIOUS portal's row.
     */
    private syncGeneration = 0;
    private pendingSync: Promise<void> = Promise.resolve();
    /**
     * False while this session is applying the route to the store. Its sync
     * resets the selected category and item (and, on a section change, the
     * search) before awaiting the playlist, and the store keeps the previous
     * portal's playlist and cache across a revisit — so anything that acts on
     * store state for an arrival (the live auto-open handoff) must wait, or
     * its selection is wiped a tick later.
     */
    readonly isReady = this.synced.asReadonly();

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
                // Synchronous, and before the async sync: this session's
                // subscription is registered from an ENVIRONMENT_INITIALIZER
                // when the route injector is created, so it runs ahead of the
                // components that read `isReady`.
                this.synced.set(false);
                void this.syncRouteContext();
            });

        void this.syncRouteContext();

        this.destroyRef.onDestroy(() => {
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();
        });
    }

    private syncRouteContext(): Promise<void> {
        const generation = ++this.syncGeneration;
        // Read the route SYNCHRONOUSLY: `syncFromUrl` publishes the active
        // playlist context, and deferring it onto the queue would leave every
        // consumer of that context a tick behind the navigation.
        const routeContext = this.playlistContext.syncFromUrl(this.router.url);
        const run = async (): Promise<void> => {
            try {
                await this.applyRouteContext(generation, routeContext);
            } catch {
                // A failed bootstrap deliberately leaves readiness false: the
                // store may still hold the previous portal, and acting on that
                // is worse than not acting at all.
            }
        };

        this.pendingSync = this.pendingSync.then(run, run);

        return this.pendingSync;
    }

    private async applyRouteContext(
        generation: number,
        routeContext: ReturnType<PlaylistContextFacade['syncFromUrl']>
    ): Promise<void> {
        const playlistId =
            routeContext.provider === 'stalker'
                ? routeContext.playlistId
                : null;

        if (playlistId && this.currentPlaylistId !== playlistId) {
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();

            const playlist = await this.resolveStalkerPlaylist(playlistId);
            await this.stalkerStore.setCurrentPlaylist(playlist);
            this.currentPlaylistId = playlistId;
        }

        if (generation !== this.syncGeneration) {
            // A newer arrival is queued behind this one and owns readiness.
            return;
        }

        this.syncRouteState(routeContext.section);
        this.synced.set(true);
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
