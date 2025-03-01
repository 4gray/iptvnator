import { Component, inject } from '@angular/core';
import { CategoryViewComponent } from './category-view/category-view.component';

import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamCategory } from '../../../shared/xtream-category.interface';
import { MpvPlayerBarComponent } from '../shared/components/mpv-player-bar/mpv-player-bar.component';
import { XtreamStore } from './xtream.store';

@Component({
    selector: 'app-xtream-main-container',
    templateUrl: './xtream-main-container.component.html',
    styleUrls: ['./xtream-main-container.component.scss', './sidebar.scss'],
    standalone: true,
    imports: [
        CategoryViewComponent,
        TranslateModule,
        RouterOutlet,
        MpvPlayerBarComponent,
        MatIcon,
        MatIconButton,
    ],
})
export class XtreamMainContainerComponent {
    readonly xtreamStore = inject(XtreamStore);

    constructor(
        private router: Router,
        private route: ActivatedRoute
    ) {}

    categoryClicked(category: XtreamCategory) {
        const categoryId = (category as any).category_id ?? category.id;
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
            const selectedCategory = this.xtreamStore.getSelectedCategory();
            return selectedCategory
                ? `Content for ${(selectedCategory as any).name}`
                : 'Category Content';
        }
    }

    historyBack() {
        this.router.navigate(['.', this.xtreamStore.selectedCategoryId()], {
            relativeTo: this.route,
        });
    }
}
