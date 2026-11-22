import {
    ChangeDetectionStrategy,
    Component,
    effect,
    inject,
    signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    CategoryEditorComponent,
    CategoryEditorRow,
} from '@iptvnator/portal/shared/ui';
import { StalkerCategoryItem } from '@iptvnator/portal/stalker/data-access';
import { ParentalLockService, PlaylistsService } from '@iptvnator/services';
import { ParentalLockStalkerCategoryType } from '@iptvnator/shared/interfaces';

export interface StalkerCategoryLockDialogData {
    playlistId: string;
    contentType: ParentalLockStalkerCategoryType;
    /** Every genre of the section, including currently hidden genres. */
    categories: StalkerCategoryItem[];
    hiddenIds: readonly string[];
    itemCounts?: ReadonlyMap<string, number>;
}

interface StalkerEditorRow extends CategoryEditorRow {
    readonly id: string;
}

@Component({
    selector: 'app-stalker-category-lock-dialog',
    imports: [CategoryEditorComponent],
    template: `
        <app-category-editor
            [(categories)]="categories"
            subtitle="WORKSPACE.CONTEXT.STALKER_PORTAL"
            [showLocks]="parentalLock.enabled()"
            [showBulkLocks]="true"
            [isSaving]="isSaving()"
            (saveRequested)="save()"
            (cancelled)="dialogRef.close(false)"
        />
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StalkerCategoryLockDialogComponent {
    readonly data = inject<StalkerCategoryLockDialogData>(MAT_DIALOG_DATA);
    readonly dialogRef = inject(
        MatDialogRef<StalkerCategoryLockDialogComponent, boolean>
    );
    readonly parentalLock = inject(ParentalLockService);
    private readonly playlists = inject(PlaylistsService);
    private readonly store = inject(Store);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);

    private readonly hiddenIds = new Set(this.data.hiddenIds);
    private readonly lockedIds = new Set(
        this.parentalLock.lockedStalkerIds(
            this.data.playlistId,
            this.data.contentType
        )
    );
    readonly isSaving = signal(false);
    readonly categories = signal<StalkerEditorRow[]>(
        this.data.categories.map((category) => {
            const id = String(category.category_id);
            return {
                id,
                providerId: id,
                name: category.category_name,
                selected: !this.hiddenIds.has(id),
                lockedDraft: this.lockedIds.has(id),
                censored: category.censored === true,
                count: this.data.itemCounts?.get(id),
            };
        })
    );

    constructor() {
        effect(() => {
            if (this.parentalLock.active()) this.dialogRef.close(false);
        });
    }

    async save(): Promise<void> {
        if (this.isSaving() || this.parentalLock.active()) return;
        this.isSaving.set(true);
        let errorKey = 'XTREAM.CATEGORY_MANAGEMENT.SAVE_FAILED';
        try {
            const rows = this.categories();
            await this.saveVisibility(rows);
            if (this.parentalLock.active()) return;
            errorKey = 'PARENTAL_LOCK.SAVE_FAILED';
            if (this.parentalLock.enabled() && !(await this.saveLocks(rows))) {
                this.showError(errorKey);
                return;
            }
            this.dialogRef.close(true);
        } catch {
            this.showError(errorKey);
        } finally {
            this.isSaving.set(false);
        }
    }

    private async saveVisibility(rows: StalkerEditorRow[]): Promise<void> {
        const hide = rows
            .filter((row) => !row.selected && !this.hiddenIds.has(row.id))
            .map((row) => row.id);
        const show = rows
            .filter((row) => row.selected && this.hiddenIds.has(row.id))
            .map((row) => row.id);
        if (!hide.length && !show.length) return;

        const { playlistId, contentType } = this.data;
        const saved = await firstValueFrom(
            this.playlists.updateStalkerCategoryVisibility(playlistId, {
                [contentType]: { hide, show },
            })
        );
        // A lock write can still fail. On retry compare against the visibility
        // changes already saved, even if the user edits those checkboxes again.
        for (const id of hide) this.hiddenIds.add(id);
        for (const id of show) this.hiddenIds.delete(id);
        this.store.dispatch(
            PlaylistActions.stalkerCategoryVisibilitySaved({
                playlistId,
                hiddenStalkerCategories: saved.hiddenStalkerCategories ?? {},
            })
        );
    }

    private saveLocks(rows: StalkerEditorRow[]): Promise<boolean> {
        const edits = rows.filter(
            (row) => row.lockedDraft !== this.lockedIds.has(row.id)
        );
        if (!edits.length) return Promise.resolve(true);
        return this.parentalLock.setStalkerLocks(
            this.data.playlistId,
            this.data.contentType,
            (current) => {
                const ids = new Set(current);
                for (const row of edits) {
                    if (row.lockedDraft) ids.add(row.id);
                    else ids.delete(row.id);
                }
                return [...ids];
            }
        );
    }

    private showError(key: string): void {
        this.snackBar.open(
            this.translate.instant(key),
            this.translate.instant('CLOSE'),
            { duration: 3000 }
        );
    }
}
