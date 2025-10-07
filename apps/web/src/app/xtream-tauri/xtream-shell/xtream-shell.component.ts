import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import * as PlaylistActions from '../../state/actions';
import { LoadingOverlayComponent } from '../loading-overlay/loading-overlay.component';
import { NavigationComponent } from '../navigation/navigation.component';
import { NavigationItem } from '../navigation/navigation.interface';
import { XtreamStore } from '../xtream.store';

@Component({
    templateUrl: './xtream-shell.component.html',
    styleUrls: ['./xtream-shell.component.scss'],
    imports: [
        LoadingOverlayComponent,
        NavigationComponent,
        RouterOutlet,
        TranslateModule,
    ],
    providers: [XtreamStore],
})
export class XtreamShellComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    readonly xtreamStore = inject(XtreamStore);

    readonly getImportCount = this.xtreamStore.getImportCount;
    readonly isImporting = this.xtreamStore.isImporting;
    readonly itemsToImport = this.xtreamStore.itemsToImport;
    readonly portalStatus = this.xtreamStore.portalStatus;

    readonly mainNavigationItems: NavigationItem[] = [
        {
            id: 'vod',
            icon: 'movie',
            labelKey: 'PORTALS.SIDEBAR.MOVIES',
        },
        {
            id: 'live',
            icon: 'live_tv',
            labelKey: 'PORTALS.SIDEBAR.LIVE_TV',
        },
        {
            id: 'series',
            icon: 'tv',
            labelKey: 'PORTALS.SIDEBAR.SERIES',
        },
    ];

    constructor() {
        effect(
            () => {
                if (this.xtreamStore.currentPlaylist() !== null) {
                    this.xtreamStore.initializeContent();
                }
            },
            { allowSignalWrites: true }
        );
    }

    ngOnInit() {
        this.xtreamStore.checkPortalStatus();
        this.store.dispatch(
            PlaylistActions.setActivePlaylist({
                playlistId: this.route.snapshot.params.id,
            })
        );
    }

    handleCategoryClick(category: 'vod' | 'live' | 'series') {
        this.xtreamStore.setSelectedContentType(category);
        this.router.navigate([category], {
            relativeTo: this.route,
        });
    }

    handlePageClick(page: 'search' | 'recent' | 'favorites') {
        this.xtreamStore.setSelectedContentType(undefined);
        this.router.navigate([page], {
            relativeTo: this.route,
        });
    }
}
