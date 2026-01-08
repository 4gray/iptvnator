import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { TranslatePipe } from '@ngx-translate/core';
import { XtreamCategory } from 'shared-interfaces';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';

@Component({
    selector: 'app-category-view',
    imports: [MatListModule, PlaylistErrorViewComponent, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './category-view.component.html',
    styleUrls: ['./category-view.component.scss'],
})
export class CategoryViewComponent {
    readonly items = input([]);
    readonly selectedCategoryId = input<number>();
    readonly itemCounts = input<Map<number, number>>(new Map());
    readonly showCounts = input<boolean>(false);

    readonly categoryClicked = output<XtreamCategory>();

    isSelected(item: XtreamCategory): boolean {
        const selectedCategory = this.selectedCategoryId();
        const itemId = Number((item as any).category_id ?? item.id);

        return selectedCategory !== null && selectedCategory === itemId;
    }

    getItemCount(item: XtreamCategory): number {
        const itemId = Number((item as any).category_id ?? item.id);
        return this.itemCounts().get(itemId) ?? 0;
    }
}
