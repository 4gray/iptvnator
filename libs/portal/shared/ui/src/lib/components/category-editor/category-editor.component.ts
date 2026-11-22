import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    model,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { foldSearchText } from '@iptvnator/shared/interfaces';
import {
    DialogFooterDirective,
    DialogShellComponent,
} from '@iptvnator/ui/components';

export interface CategoryEditorRow {
    readonly id: number | string;
    readonly providerId: number | string;
    readonly name: string;
    readonly selected: boolean;
    readonly lockedDraft: boolean;
    readonly censored?: boolean;
    readonly count?: number;
}

@Component({
    selector: 'app-category-editor',
    imports: [
        DialogFooterDirective,
        DialogShellComponent,
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        TranslatePipe,
    ],
    templateUrl: './category-editor.component.html',
    styleUrl: './category-editor.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryEditorComponent<T extends CategoryEditorRow> {
    readonly categories = model.required<T[]>();
    readonly subtitle = input.required<string>();
    readonly supportsVisibility = input(true);
    readonly showLocks = input(false);
    readonly showBulkLocks = input(false);
    readonly isLoading = input(false);
    readonly isSaving = input(false);
    readonly saveRequested = output<void>();
    readonly cancelled = output<void>();

    readonly searchTerm = signal('');

    readonly filteredCategories = computed(() => {
        const term = foldSearchText(this.searchTerm());
        if (!term) return this.categories();
        return this.categories().filter((c) =>
            foldSearchText(c.name).includes(term)
        );
    });

    readonly selectedCount = computed(
        () => this.categories().filter((c) => c.selected).length
    );

    readonly totalCount = computed(() => this.categories().length);

    readonly filteredSelectedCount = computed(
        () => this.filteredCategories().filter((c) => c.selected).length
    );

    readonly allFilteredSelected = computed(
        () =>
            this.filteredCategories().length > 0 &&
            this.filteredSelectedCount() === this.filteredCategories().length
    );

    readonly lockedCount = computed(
        () =>
            this.categories().filter((category) => category.lockedDraft).length
    );
    readonly hasCensored = computed(() =>
        this.categories().some((category) => category.censored)
    );

    clearSearch(): void {
        this.searchTerm.set('');
    }

    toggleCategory(category: T): void {
        this.categories.update((cats) =>
            cats.map((c) =>
                c.id === category.id ? { ...c, selected: !c.selected } : c
            )
        );
    }

    toggleLock(category: T, event?: Event): void {
        event?.stopPropagation();
        this.categories.update((cats) =>
            cats.map((c) =>
                c.id === category.id ? { ...c, lockedDraft: !c.lockedDraft } : c
            )
        );
    }

    selectAll(): void {
        this.setFilteredSelection(true);
    }

    deselectAll(): void {
        this.setFilteredSelection(false);
    }

    private setFilteredSelection(selected: boolean): void {
        const ids = new Set(this.filteredCategories().map((c) => c.id));
        this.categories.update((cats) =>
            cats.map((c) => (ids.has(c.id) ? { ...c, selected } : c))
        );
    }

    lockCensored(): void {
        this.categories.update((rows) =>
            rows.map((row) =>
                row.censored ? { ...row, lockedDraft: true } : row
            )
        );
    }

    unlockAll(): void {
        this.categories.update((rows) =>
            rows.map((row) => ({ ...row, lockedDraft: false }))
        );
    }
}
