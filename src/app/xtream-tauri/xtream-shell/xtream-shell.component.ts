import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import * as PlaylistActions from '../../state/actions';
import { LoadingOverlayComponent } from '../loading-overlay/loading-overlay.component';
import { NavigationComponent } from '../navigation/navigation.component';
import { XtreamStore } from '../xtream.store';

@Component({
    templateUrl: './xtream-shell.component.html',
    styleUrls: ['./xtream-shell.component.scss'],
    standalone: true,
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
    private readonly store = inject(Store);
    private readonly xtreamStore = inject(XtreamStore);

    readonly getImportCount = this.xtreamStore.getImportCount;
    readonly isImporting = this.xtreamStore.isImporting;
    readonly itemsToImport = this.xtreamStore.itemsToImport;

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
        this.store.dispatch(
            PlaylistActions.setActivePlaylist({
                playlistId: this.route.snapshot.params.id,
            })
        );
    }
}
