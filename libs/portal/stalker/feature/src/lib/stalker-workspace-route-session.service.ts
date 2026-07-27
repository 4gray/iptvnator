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
    StalkerSessionService,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { STALKER_RECIPE_CLASSIFIER_VERSION } from '@iptvnator/portal/stalker/protocol';
import { PlaylistsService } from '@iptvnator/services';
import {
    Playlist,
    PlaylistMeta,
    type StalkerSessionLeaseRef,
} from '@iptvnator/shared/interfaces';
import { StalkerConnectionFlowService } from './stalker-connection-flow/stalker-connection-flow.service';

@Injectable()
export class StalkerWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly connectionFlow = inject(StalkerConnectionFlowService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly router = inject(Router);
    private readonly session = inject(StalkerSessionService);
    private readonly stalkerStore = inject(StalkerStore);

    private currentPlaylistId: string | null = null;
    private readonly currentSection = signal<PortalRailSection | null>(null);
    private routeSyncGeneration = 0;
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
                    void this.activateAndSetCurrentPlaylist(playlist);
                }
            });

        void this.syncRouteContext();

        this.destroyRef.onDestroy(() => {
            const playlistId = this.currentPlaylistId;
            this.currentPlaylistId = null;
            this.routeSyncGeneration += 1;
            this.syncGeneration += 1;
            void this.connectionFlow.cancel();
            if (playlistId !== null) {
                void this.releasePlaylistSession(playlistId);
            }
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();
        });
    }

    private async syncRouteContext(): Promise<void> {
        const routeGeneration = ++this.routeSyncGeneration;
        const routeContext = this.playlistContext.syncFromUrl(this.router.url);
        const playlistId =
            routeContext.provider === 'stalker'
                ? routeContext.playlistId
                : null;
        const generation =
            playlistId === this.currentPlaylistId
                ? this.syncGeneration
                : ++this.syncGeneration;

        if (!playlistId && this.currentPlaylistId !== null) {
            const previousPlaylistId = this.currentPlaylistId;
            this.currentPlaylistId = null;
            await this.connectionFlow.cancel();
            await this.releasePlaylistSession(previousPlaylistId);
            if (generation !== this.syncGeneration) {
                return;
            }
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();
            await this.stalkerStore.setCurrentPlaylist(undefined);
        } else if (playlistId && this.currentPlaylistId !== playlistId) {
            const previousPlaylistId = this.currentPlaylistId;
            this.currentPlaylistId = playlistId;
            if (previousPlaylistId !== null) {
                await this.connectionFlow.cancel();
                await this.releasePlaylistSession(previousPlaylistId);
                if (
                    generation !== this.syncGeneration ||
                    playlistId !== this.currentPlaylistId
                ) {
                    return;
                }
            }

            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();

            const playlist = await this.resolveStalkerPlaylist(playlistId);
            if (
                generation !== this.syncGeneration ||
                playlistId !== this.currentPlaylistId
            ) {
                return;
            }
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
                await this.activateAndSetCurrentPlaylist(connected);
            }
        }

        if (routeGeneration === this.routeSyncGeneration) {
            this.syncRouteState(routeContext.section);
        }
    }

    private async activateAndSetCurrentPlaylist(
        playlist: Playlist
    ): Promise<void> {
        const activationGeneration = this.syncGeneration;
        if (!this.isCurrentActivation(playlist, activationGeneration)) {
            return;
        }
        const leaseRef = this.session.getLeaseRef(playlist._id);
        if (leaseRef !== undefined) {
            try {
                const activation = await this.session.activate(leaseRef);
                if (activation.kind !== 'success') {
                    const retryEligible = this.isCurrentActivation(
                        playlist,
                        activationGeneration,
                        leaseRef
                    );
                    await this.releaseLeaseSession(leaseRef);
                    this.offerActivationRetry(
                        playlist,
                        activation.kind === 'failure'
                            ? activation.reason
                            : `session-activation-${activation.kind}`,
                        activationGeneration,
                        leaseRef,
                        retryEligible
                    );
                    return;
                }
            } catch {
                const retryEligible = this.isCurrentActivation(
                    playlist,
                    activationGeneration,
                    leaseRef
                );
                await this.releaseLeaseSession(leaseRef);
                this.offerActivationRetry(
                    playlist,
                    'session-activation-failed',
                    activationGeneration,
                    leaseRef,
                    retryEligible
                );
                return;
            }
        }
        if (
            this.isCurrentActivation(
                playlist,
                activationGeneration,
                leaseRef
            )
        ) {
            await this.stalkerStore.setCurrentPlaylist(playlist);
        }
    }

    private offerActivationRetry(
        playlist: Playlist,
        reason: string,
        activationGeneration: number,
        leaseRef: StalkerSessionLeaseRef,
        retryEligible: boolean
    ): void {
        const currentLeaseRef = this.session.getLeaseRef(playlist._id);
        if (
            retryEligible &&
            this.isCurrentActivation(playlist, activationGeneration) &&
            (currentLeaseRef === undefined || currentLeaseRef === leaseRef)
        ) {
            this.connectionFlow.offerRetry(playlist, reason);
        }
    }

    private async releasePlaylistSession(playlistId: string): Promise<void> {
        const leaseRef = this.session.getLeaseRef(playlistId);
        if (leaseRef === undefined) {
            return;
        }
        await this.releaseLeaseSession(leaseRef);
    }

    private async releaseLeaseSession(
        leaseRef: StalkerSessionLeaseRef
    ): Promise<void> {
        await this.session.deactivate(leaseRef).catch(() => undefined);
        await this.session.close(leaseRef).catch(() => undefined);
    }

    private isCurrentActivation(
        playlist: Playlist,
        activationGeneration: number,
        leaseRef?: StalkerSessionLeaseRef
    ): boolean {
        return (
            activationGeneration === this.syncGeneration &&
            playlist._id === this.currentPlaylistId &&
            (leaseRef === undefined ||
                this.session.getLeaseRef(playlist._id) === leaseRef)
        );
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

        if (this.hasCurrentStalkerRecipe(playlistId, activePlaylist)) {
            return activePlaylist;
        }

        const storedPlaylist = await firstValueFrom(
            this.playlistsService.getPlaylistById(playlistId),
            { defaultValue: null }
        );

        return storedPlaylist ?? activePlaylist ?? undefined;
    }

    private hasCurrentStalkerRecipe(
        playlistId: string,
        playlist: PlaylistMeta | null
    ): playlist is PlaylistMeta {
        return (
            playlist?._id === playlistId &&
            playlist.stalkerRequestRecipe !== undefined &&
            playlist.stalkerRecipeClassifierVersion ===
                STALKER_RECIPE_CLASSIFIER_VERSION
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
