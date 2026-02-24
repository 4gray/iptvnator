import { Component, effect, inject, OnDestroy } from '@angular/core';
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
import { createLogger } from '../../shared/utils/logger';
import { NavigationComponent } from '../../xtream-electron/navigation/navigation.component';
import { XtreamStore } from '../../xtream-electron/stores/xtream.store';
import { StalkerStore } from '../stalker.store';

@Component({
    selector: 'app-stalker-shell',
    templateUrl: './stalker-shell.component.html',
    styleUrls: ['./stalker-shell.component.scss'],
    imports: [NavigationComponent, RouterOutlet],
    providers: [XtreamStore],
})
export class StalkerShellComponent implements OnDestroy {
    private readonly logger = createLogger('StalkerShell');
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    readonly stalkerStore = inject(StalkerStore);
    private readonly store = inject(Store);
    readonly isWorkspaceLayout =
        this.route.snapshot.data['layout'] === 'workspace';

    /** Current playlist derived from route params */
    readonly currentPlaylist = toSignal(
        this.route.params.pipe(
            map((params) => params['id']),
            switchMap((id) => this.store.select(selectPlaylistById(id)))
        )
    );
    private currentSection: string | null = null;

    constructor() {
        // Subscribe to route params to handle switching between playlists
        this.route.params.pipe(takeUntilDestroyed()).subscribe((params) => {
            const playlistId = params['id'];

            this.store.dispatch(
                PlaylistActions.setActivePlaylist({ playlistId })
            );
            this.store.dispatch(
                PlaylistActions.setCurrentPlaylistId({ playlistId })
            );

            // Reset store state when switching playlists
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);

            const childRoute = this.route.snapshot.firstChild;
            const path = childRoute?.url?.[0]?.path;
            const validTypes = ['vod', 'series', 'itv'];
            const initialType = validTypes.includes(path)
                ? (path as any)
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

    ngOnDestroy() {
        this.stalkerStore.resetCategories();
    }

    private syncSectionFromRoute(): void {
        const sectionFromSnapshot =
            this.route.firstChild?.snapshot?.url?.[0]?.path ?? null;
        const sectionFromUrl = this.getSectionFromUrl(this.router.url);
        const section = sectionFromSnapshot ?? sectionFromUrl;

        if (!section || section === this.currentSection) {
            return;
        }

        this.currentSection = section;

        if (section === 'vod' || section === 'series' || section === 'itv') {
            this.stalkerStore.setSelectedContentType(section as any);
            return;
        }

        this.stalkerStore.setSelectedContentType(null as any);
    }

    private getSectionFromUrl(url: string): string | null {
        const match = url.match(
            /^\/(?:workspace\/)?stalker\/[^\/\?]+\/([^\/\?]+)/
        );
        return match?.[1] ?? null;
    }
}
