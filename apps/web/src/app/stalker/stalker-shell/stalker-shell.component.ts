import { Component, effect, inject, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import * as PlaylistActions from 'm3u-state';
import { selectPlaylistById } from 'm3u-state';
import { NavigationComponent } from '../../xtream-tauri/navigation/navigation.component';
import { NavigationItem } from '../../xtream-tauri/navigation/navigation.interface';
import { StalkerStore } from '../stalker.store';

@Component({
    selector: 'app-stalker-shell',
    templateUrl: './stalker-shell.component.html',
    styleUrls: ['./stalker-shell.component.scss'],
    standalone: true,
    imports: [NavigationComponent, RouterOutlet, NavigationComponent],
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

    readonly currentPlaylist = this.store.selectSignal(
        selectPlaylistById(this.route.snapshot.params.id)
    );

    constructor() {
        this.store.dispatch(
            PlaylistActions.setCurrentPlaylistId({
                playlistId: this.route.snapshot.params['id'],
            })
        );
        this.stalkerStore.setSelectedContentType('vod');
        this.stalkerStore.setSelectedCategory(null);
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
