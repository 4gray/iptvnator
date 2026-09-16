import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    computed,
    input,
    model,
    viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
    CategorySearchMode,
    categorySearchTerms,
    serializeCategorySearch,
} from '@iptvnator/portal/shared/util';

function exclusionTerms(query: string): string[] {
    return categorySearchTerms(query).map((term) =>
        term.startsWith('-') ? term.slice(1) : term
    );
}

@Component({
    selector: 'app-category-search',
    imports: [TranslatePipe],
    templateUrl: './category-search.component.html',
    styleUrl: './category-search.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategorySearchComponent {
    readonly query = model('');
    readonly exclusions = model('');
    readonly mode = model<CategorySearchMode>('all');
    readonly matched = input(0);
    readonly total = input(0);
    readonly keywords = computed(() => categorySearchTerms(this.query()));
    readonly excludedKeywords = computed(() => exclusionTerms(this.exclusions()));
    private readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');

    focus(): void {
        this.searchInput()?.nativeElement.focus();
    }

    remove(index: number, excluded = false): void {
        const target = excluded ? this.exclusions : this.query;
        target.set(
            serializeCategorySearch(
                (excluded ? exclusionTerms(target()) : categorySearchTerms(target())).filter(
                    (_, i) => i !== index
                )
            )
        );
    }

    clear(): void {
        this.query.set('');
        this.exclusions.set('');
        this.mode.set('all');
        this.focus();
    }
}
