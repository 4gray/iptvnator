import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { TranslatePipe } from '@ngx-translate/core';
import { XtreamCategory } from '../../../../shared/xtream-category.interface';
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

    readonly categoryClicked = output<XtreamCategory>();

    isSelected(item: XtreamCategory): boolean {
        const selectedCategory = this.selectedCategoryId();
        const itemId = (item as any).category_id ?? item.id;

        return (
            selectedCategory !== null &&
            String(selectedCategory) === String(itemId)
        );
    }
}
