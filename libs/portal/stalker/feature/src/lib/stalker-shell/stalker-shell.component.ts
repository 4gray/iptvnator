import { Component, computed, effect, inject, OnDestroy, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
    ActivatedRoute,
    NavigationEnd,
    Router,
    RouterOutlet,
} from '@angular/router';
import { Store } from '@ngrx/store';
import { PlaylistActions, selectPlaylistById } from 'm3u-state';
import { map, switchMap } from 'rxjs';
import {
    isWorkspaceLayoutRoute,
    PortalRailSection,
    resolveCurrentPortalSection,
} from '@iptvnator/portal/shared/util';
import { NavigationComponent } from '@iptvnator/portal/shared/ui';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';

type StalkerContentType = 'vod' | 'series' | 'itv';

@Component({
    selector: 'app-stalker-shell',
    templateUrl: './stalker-shell.component.html',
    styleUrls: ['./stalker-shell.component.scss'],
    imports: [NavigationComponent, RouterOutlet],
})
export class StalkerShellComponent implements OnDestroy {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    readonly stalkerStore = inject(StalkerStore);
    private readonly store = inject(Store);
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);

    readonly currentPlaylist = toSignal(
        this.route.params.pipe(
            map((params) => params['id']),
            switchMap((id) => this.store.select(selectPlaylistById(id)))
        )
    );
    readonly selectedSection = computed<PortalRailSection | undefined>(() => {
        const section = this.currentSection();
        return section ?? undefined;
    });

    private readonly currentSection = signal<PortalRailSection | null>(null);

    constructor() {
        this.route.params.pipe(takeUntilDestroyed()).subscribe((params) => {
            const playlistId = params['id'];

            this.store.dispatch(
                PlaylistActions.setActivePlaylist({ playlistId })
            );
            this.store.dispatch(
                PlaylistActions.setCurrentPlaylistId({ playlistId })
            );

            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);

            const childRoute = this.route.snapshot.firstChild;
            const path = childRoute?.url?.[0]?.path;
            const initialType: StalkerContentType =
                path === 'itv' || path === 'series' || path === 'vod'
                    ? path
                    : 'vod';
            this.stalkerStore.setSelectedContentType(initialType);
        });

        this.router.events
            .pipe(takeUntilDestroyed())
            .subscribe((event) => {
                if (event instanceof NavigationEnd) {
                    this.syncSectionFromRoute();
                }
            });

        this.syncSectionFromRoute();

        effect(() => {
            this.stalkerStore.setCurrentPlaylist(this.currentPlaylist());
        });
    }

    ngOnDestroy(): void {
        this.stalkerStore.resetCategories();
    }

    private syncSectionFromRoute(): void {
        const section = resolveCurrentPortalSection(
            this.route,
            this.router.url,
            'stalker'
        );

        if (!section || section === this.currentSection()) {
            return;
        }

        this.currentSection.set(section);

        if (section === 'vod' || section === 'series' || section === 'itv') {
            this.stalkerStore.setSelectedContentType(section);
        }
    }
}
