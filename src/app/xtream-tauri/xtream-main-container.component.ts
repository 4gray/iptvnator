import { Component, effect, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { CategoryViewComponent } from './category-view/category-view.component';

import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamCategory } from '../../../shared/xtream-category.interface';
import { MpvPlayerBarComponent } from '../shared/components/mpv-player-bar/mpv-player-bar.component';
import * as PlaylistActions from '../state/actions';
import { LoadingOverlayComponent } from './loading-overlay/loading-overlay.component';
import { NavigationComponent } from './navigation/navigation.component';
import { XtreamStore } from './xtream.store';

@Component({
    selector: 'app-xtream-main-container',
    templateUrl: './xtream-main-container.component.html',
    styleUrls: ['./xtream-main-container.component.scss'],
    standalone: true,
    imports: [
        CategoryViewComponent,
        TranslateModule,
        RouterOutlet,
        NavigationComponent,
        LoadingOverlayComponent,
        MpvPlayerBarComponent,
        MatIcon,
        MatIconButton,
    ],
    providers: [XtreamStore],
})
export class XtreamMainContainerComponent {
    readonly xtreamStore = inject(XtreamStore);

    private store = inject(Store);

    constructor(
        private router: Router,
        private route: ActivatedRoute
    ) {
        effect(
            () => {
                if (this.xtreamStore.currentPlaylist() !== null) {
                    console.log(
                        'Initializing content...',
                        this.xtreamStore.currentPlaylist()
                    );
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
        //this.xtreamStore.fetchXtreamPlaylist();
    }

    categoryClicked(category: XtreamCategory) {
        const categoryId = (category as any).category_id ?? category.id;
        console.log('Category clicked:', category);
        this.xtreamStore.setSelectedCategory(Number(categoryId));

        this.router.navigate([categoryId], {
            relativeTo: this.route,
        });
    }

    getContentLabel(): string {
        if (
            this.xtreamStore.getSelectedCategory() === null ||
            this.xtreamStore.getSelectedCategory() === undefined
        ) {
            return 'Select a category';
        } else {
            // TODO: Fix this
            //console.log(this.xtreamStore.getSelectedCategory());
            const selectedCategory = this.xtreamStore.getSelectedCategory();
            return selectedCategory
                ? `Content for ${(selectedCategory as any).name}`
                : 'Category Content';
        }
    }

    historyBack() {
        this.router.navigate([
            './xtreams',
            this.xtreamStore.currentPlaylist().id,
            this.xtreamStore.selectedCategoryId(),
        ]);
    }
}
