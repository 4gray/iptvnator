import { Component, effect, inject, OnDestroy } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { PlaylistActions, selectPlaylistById } from 'm3u-state';
import { map, switchMap } from 'rxjs';
import { NavigationComponent } from '../../xtream-tauri/navigation/navigation.component';
import { NavigationItem } from '../../xtream-tauri/navigation/navigation.interface';
import { XtreamStore } from '../../xtream-tauri/stores/xtream.store';
import { StalkerStore } from '../stalker.store';

@Component({
    selector: 'app-stalker-shell',
    templateUrl: './stalker-shell.component.html',
    styleUrls: ['./stalker-shell.component.scss'],
    imports: [NavigationComponent, RouterOutlet],
    providers: [XtreamStore],
})
export class StalkerShellComponent implements OnDestroy {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    readonly stalkerStore = inject(StalkerStore);
    private readonly store = inject(Store);

    readonly mainNavigationItems: NavigationItem[] = [
        {
            id: 'vod',
            icon: 'movie',
            labelKey: 'PORTALS.SIDEBAR.MOVIES',
        },
        {
            id: 'itv',
            icon: 'live_tv',
            labelKey: 'PORTALS.SIDEBAR.LIVE_TV',
        },
        {
            id: 'series',
            icon: 'tv',
            labelKey: 'PORTALS.SIDEBAR.SERIES',
        },
    ];

    /** Current playlist derived from route params */
    readonly currentPlaylist = toSignal(
        this.route.params.pipe(
            map((params) => params['id']),
            switchMap((id) => this.store.select(selectPlaylistById(id)))
        )
    );

    constructor() {
        // Subscribe to route params to handle switching between playlists
        this.route.params.pipe(takeUntilDestroyed()).subscribe((params) => {
            const playlistId = params['id'];

            this.store.dispatch(
                PlaylistActions.setCurrentPlaylistId({ playlistId })
            );

            // Reset store state when switching playlists
            this.stalkerStore.resetCategories();
            this.stalkerStore.setSelectedCategory(null);

            const childRoute = this.route.snapshot.firstChild;
            const path = childRoute?.url[0]?.path;
            const validTypes = ['vod', 'series', 'itv'];
            const initialType = validTypes.includes(path) ? (path as any) : 'vod';
            this.stalkerStore.setSelectedContentType(initialType);
        });

        effect(() => {
            this.stalkerStore.setCurrentPlaylist(this.currentPlaylist());
        });
    }

    setContentType(type: 'vod' | 'live' | 'series' | 'itv') {
        if (type === 'live') type = 'itv';
        this.stalkerStore.setSelectedContentType(type);
        this.stalkerStore.setSelectedCategory(null);
        this.router.navigate([type], {
            relativeTo: this.route,
        });
    }

    handlePageClick() {
        this.stalkerStore.setSelectedContentType(null);
    }

    ngOnDestroy() {
        this.stalkerStore.resetCategories();
    }
}
