import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StalkerCategoryItem } from '@iptvnator/portal/stalker/data-access';
import { ParentalLockService } from '@iptvnator/services';
import { ParentalLockStalkerCategoryType } from '@iptvnator/shared/interfaces';

export interface StalkerCategoryLockDialogData {
    playlistId: string;
    contentType: ParentalLockStalkerCategoryType;
    /** Every genre of the section, the "All" pseudo-category excluded. */
    categories: StalkerCategoryItem[];
}

interface LockableCategory {
    readonly id: string;
    readonly name: string;
    readonly censored: boolean;
    readonly locked: boolean;
}

/**
 * Parental lock picker for a Stalker section's genres. Stalker has no
 * hide/show dialog (its genres are never persisted), so this is the only
 * category dialog for that portal type; it exists while the lock is on.
 */
@Component({
    selector: 'app-stalker-category-lock-dialog',
    imports: [
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        TranslatePipe,
    ],
    templateUrl: './stalker-category-lock-dialog.component.html',
    styleUrl: './stalker-category-lock-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerCategoryLockDialogComponent {
    readonly data = inject<StalkerCategoryLockDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject(
        MatDialogRef<StalkerCategoryLockDialogComponent, boolean>
    );
    private readonly parentalLock = inject(ParentalLockService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);

    readonly searchTerm = signal('');
    readonly isSaving = signal(false);
    readonly categories = signal<LockableCategory[]>(this.buildDraft());

    readonly filteredCategories = computed(() => {
        const term = this.searchTerm().trim().toLowerCase();
        const categories = this.categories();
        return term
            ? categories.filter((category) =>
                  category.name.toLowerCase().includes(term)
              )
            : categories;
    });
    readonly lockedCount = computed(
        () => this.categories().filter((category) => category.locked).length
    );
    readonly censoredCount = computed(
        () => this.categories().filter((category) => category.censored).length
    );

    private buildDraft(): LockableCategory[] {
        const locked = new Set(
            this.parentalLock.lockedStalkerIds(
                this.data.playlistId,
                this.data.contentType
            )
        );
        return this.data.categories.map((category) => {
            const id = String(category.category_id);
            return {
                id,
                name: category.category_name,
                censored: category.censored === true,
                locked: locked.has(id),
            };
        });
    }

    clearSearch(): void {
        this.searchTerm.set('');
    }

    toggle(category: LockableCategory): void {
        this.categories.update((categories) =>
            categories.map((current) =>
                current.id === category.id
                    ? { ...current, locked: !current.locked }
                    : current
            )
        );
    }

    /** Pre-checks the genres the portal itself flags as adult (`censored`). */
    lockCensored(): void {
        this.categories.update((categories) =>
            categories.map((current) =>
                current.censored ? { ...current, locked: true } : current
            )
        );
    }

    unlockAll(): void {
        this.categories.update((categories) =>
            categories.map((current) => ({ ...current, locked: false }))
        );
    }

    async save(): Promise<void> {
        this.isSaving.set(true);
        try {
            const saved = await this.parentalLock.setStalkerLocks(
                this.data.playlistId,
                this.data.contentType,
                this.categories()
                    .filter((category) => category.locked)
                    .map((category) => category.id)
            );
            if (!saved) {
                this.snackBar.open(
                    this.translate.instant('PARENTAL_LOCK.SAVE_FAILED'),
                    this.translate.instant('CLOSE'),
                    { duration: 3000 }
                );
                return;
            }
            this.dialogRef.close(true);
        } finally {
            this.isSaving.set(false);
        }
    }

    cancel(): void {
        this.dialogRef.close(false);
    }
}
