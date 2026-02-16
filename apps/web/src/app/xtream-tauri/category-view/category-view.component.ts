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
    readonly selectedCategoryId = input<string | number | null | undefined>();
    readonly itemCounts = input<Map<number, number>>(new Map());
    readonly showCounts = input<boolean>(false);

    readonly categoryClicked = output<XtreamCategory>();

    isSelected(item: XtreamCategory): boolean {
        const selectedCategory = this.selectedCategoryId();
        const itemId = (item as any).category_id ?? item.id;

        // Compare as strings to handle both numeric and string category IDs.
        return selectedCategory != null && String(selectedCategory) === String(itemId);
    }

    getItemCount(item: XtreamCategory): number {
        // content.category_id references categories.id (internal DB id)
        // For DB format categories, use id; for API format, use category_id
        const itemId = Number(item.id ?? (item as any).category_id);
        return this.itemCounts().get(itemId) ?? 0;
    }
}
