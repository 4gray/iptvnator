import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    CollectionContentType,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { ContentCardComponent } from '../content-card/content-card.component';

@Component({
    selector: 'app-unified-grid-tab',
    templateUrl: './unified-grid-tab.component.html',
    styleUrl: './unified-grid-tab.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ContentCardComponent, MatIconModule, TranslatePipe],
})
export class UnifiedGridTabComponent {
    readonly items = input.required<UnifiedCollectionItem[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly contentType = input<CollectionContentType>('movie');
    readonly searchTerm = input('');

    readonly removeItem = output<UnifiedCollectionItem>();
    readonly itemSelected = output<UnifiedCollectionItem>();

    private readonly normalizedSearchTerm = computed(() =>
        this.searchTerm().trim().toLowerCase()
    );
    /**
     * Search results are identified by the name the user typed, so a
     * filtered grid keeps its titles even under the posters-only wall.
     */
    readonly hasActiveSearch = computed(
        () => this.normalizedSearchTerm().length > 0
    );

    readonly filteredItems = computed(() => {
        const term = this.normalizedSearchTerm();
        const all = this.items();
        return term
            ? all.filter((i) => i.name.toLowerCase().includes(term))
            : all;
    });

    onCardClick(item: UnifiedCollectionItem): void {
        this.itemSelected.emit(item);
    }

    onRemove(item: UnifiedCollectionItem): void {
        this.removeItem.emit(item);
    }

    trackByUid(_: number, item: UnifiedCollectionItem): string {
        return item.uid;
    }
}
