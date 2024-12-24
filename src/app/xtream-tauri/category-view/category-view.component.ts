import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    Output,
    inject,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';
import { XtreamStore } from '../xtream.store';

@Component({
    selector: 'app-category-view',
    standalone: true,
    imports: [
        MatCardModule,
        MatListModule,
        MatTooltipModule,
        PlaylistErrorViewComponent,
        TranslateModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './category-view.component.html',
    styleUrls: ['./category-view.component.scss'],
})
export class CategoryViewComponent {
    @Output() categoryClicked = new EventEmitter<XtreamCategory>();

    readonly xtreamStore = inject(XtreamStore);
    private readonly route = inject(ActivatedRoute);

    ngOnInit(): void {
        const { categoryId } = this.route.snapshot.params;
        if (categoryId)
            this.xtreamStore.setSelectedCategory(Number(categoryId));
    }

    isSelected(item: XtreamCategory): boolean {
        const selectedCategory = this.xtreamStore.selectedCategoryId();
        const itemId = Number((item as any).category_id || item.id);
        return selectedCategory !== null && selectedCategory === itemId;
    }
}
