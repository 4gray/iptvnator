import {
    DestroyRef,
    ENVIRONMENT_INITIALIZER,
    inject,
    Injectable,
    Provider,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
    ActivatedRoute,
    NavigationEnd,
    Router,
} from '@angular/router';
import { Store } from '@ngrx/store';
import {
    PlaylistActions,
    selectPlaylistById,
} from 'm3u-state';
import { filter, firstValueFrom, take } from 'rxjs';
import {
    PortalRailSection,
    resolveCurrentPortalPlaylistId,
    resolveCurrentPortalSection,
} from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';

type StalkerContentType = 'vod' | 'series' | 'itv';

@Injectable()
export class StalkerWorkspaceRouteSession {
    private readonly destroyRef = inject(DestroyRef);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly store = inject(Store);

    private currentPlaylistId: string | null = null;
    private readonly currentSection = signal<PortalRailSection | null>(null);

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

        this.destroyRef.onDestroy(() => {
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();
        });
    }

    private async syncRouteContext(): Promise<void> {
        const playlistId = resolveCurrentPortalPlaylistId(
            this.route,
            this.router.url,
            'stalker'
        );

        if (playlistId && this.currentPlaylistId !== playlistId) {
            this.currentPlaylistId = playlistId;

            this.store.dispatch(
                PlaylistActions.setActivePlaylist({ playlistId })
            );
            this.store.dispatch(
                PlaylistActions.setCurrentPlaylistId({ playlistId })
            );

            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();

            const playlist = await firstValueFrom(
                this.store.select(selectPlaylistById(playlistId)).pipe(take(1))
            );
            this.stalkerStore.setCurrentPlaylist(playlist);
        }

        this.syncRouteState();
    }

    private syncRouteState(): void {
        const section = resolveCurrentPortalSection(
            this.route,
            this.router.url,
            'stalker'
        );

        if (!section) {
            return;
        }

        const previousSection = this.currentSection();

        if (section !== previousSection) {
            this.currentSection.set(section);
        }

        if (section === 'vod' || section === 'series' || section === 'itv') {
            this.stalkerStore.setSelectedContentType(section as StalkerContentType);
        }

        if (section === 'itv' && previousSection !== 'itv') {
            this.stalkerStore.setSelectedCategory(null);
            this.stalkerStore.clearSelectedItem();
            this.stalkerStore.setSearchPhrase('');
        }
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
