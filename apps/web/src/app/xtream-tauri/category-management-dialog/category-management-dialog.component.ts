import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { DatabaseService, XCategoryFromDb } from 'services';

export interface CategoryManagementDialogData {
    playlistId: string;
    contentType: 'live' | 'vod' | 'series';
}

interface CategoryWithSelection extends XCategoryFromDb {
    selected: boolean;
}

@Component({
    selector: 'app-category-management-dialog',
    imports: [
        MatDialogModule,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatProgressSpinnerModule,
        FormsModule,
        TranslatePipe,
    ],
    templateUrl: './category-management-dialog.component.html',
    styleUrl: './category-management-dialog.component.scss',
})
export class CategoryManagementDialogComponent implements OnInit {
    private readonly dbService = inject(DatabaseService);
    private readonly dialogRef = inject(
        MatDialogRef<CategoryManagementDialogComponent>
    );
    readonly data = inject<CategoryManagementDialogData>(MAT_DIALOG_DATA);

    readonly isLoading = signal(true);
    readonly isSaving = signal(false);
    readonly categories = signal<CategoryWithSelection[]>([]);
    readonly searchTerm = signal('');

    readonly filteredCategories = computed(() => {
        const term = this.searchTerm().toLowerCase();
        if (!term) return this.categories();
        return this.categories().filter((c) =>
            c.name.toLowerCase().includes(term)
        );
    });

    readonly selectedCount = computed(
        () => this.categories().filter((c) => c.selected).length
    );

    readonly totalCount = computed(() => this.categories().length);

    readonly allSelected = computed(
        () =>
            this.categories().length > 0 &&
            this.categories().every((c) => c.selected)
    );

    readonly someSelected = computed(
        () => this.categories().some((c) => c.selected) && !this.allSelected()
    );

    async ngOnInit(): Promise<void> {
        await this.loadCategories();
    }

    private async loadCategories(): Promise<void> {
        try {
            const type = this.getDbType();
            const allCategories = await this.dbService.getAllXtreamCategories(
                this.data.playlistId,
                type
            );
            this.categories.set(
                allCategories.map((c) => ({
                    ...c,
                    selected: !c.hidden,
                }))
            );
        } catch (error) {
            console.error('Error loading categories:', error);
        } finally {
            this.isLoading.set(false);
        }
    }

    clearSearch(): void {
        this.searchTerm.set('');
    }

    private getDbType(): 'live' | 'movies' | 'series' {
        switch (this.data.contentType) {
            case 'live':
                return 'live';
            case 'vod':
                return 'movies';
            case 'series':
                return 'series';
        }
    }

    toggleCategory(category: CategoryWithSelection): void {
        this.categories.update((cats) =>
            cats.map((c) =>
                c.id === category.id ? { ...c, selected: !c.selected } : c
            )
        );
    }

    selectAll(): void {
        this.categories.update((cats) =>
            cats.map((c) => ({ ...c, selected: true }))
        );
    }

    deselectAll(): void {
        this.categories.update((cats) =>
            cats.map((c) => ({ ...c, selected: false }))
        );
    }

    toggleAll(): void {
        if (this.allSelected()) {
            this.deselectAll();
        } else {
            this.selectAll();
        }
    }

    async save(): Promise<void> {
        this.isSaving.set(true);
        try {
            const categories = this.categories();

            // Get IDs of categories to hide (unselected)
            const toHide = categories
                .filter((c) => !c.selected)
                .map((c) => c.id);

            // Get IDs of categories to show (selected)
            const toShow = categories
                .filter((c) => c.selected)
                .map((c) => c.id);

            // Update visibility in database
            if (toHide.length > 0) {
                await this.dbService.updateCategoryVisibility(toHide, true);
            }
            if (toShow.length > 0) {
                await this.dbService.updateCategoryVisibility(toShow, false);
            }

            this.dialogRef.close(true);
        } catch (error) {
            console.error('Error saving category visibility:', error);
        } finally {
            this.isSaving.set(false);
        }
    }

    cancel(): void {
        this.dialogRef.close(false);
    }
}
