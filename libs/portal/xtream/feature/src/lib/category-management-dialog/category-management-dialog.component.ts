import {
    ChangeDetectionStrategy,
    Component,
    effect,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import {
    MAT_DIALOG_DATA,
    MatDialogRef,
    MatDialogState,
} from '@angular/material/dialog';
import { NotificationService } from '@iptvnator/services/notifications';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import {
    DatabaseService,
    editPwaXtreamVisibility,
    ParentalLockService,
    RuntimeCapabilitiesService,
    SourceActivityService,
    USER_DATA_STORAGE,
    XCategoryFromDb,
} from '@iptvnator/services';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    CategoryEditorComponent,
    CategoryEditorRow,
} from '@iptvnator/portal/shared/ui';

export interface CategoryManagementDialogData {
    playlistId: string;
    contentType: 'live' | 'vod' | 'series';
    itemCounts: Map<number, number>;
}

interface CategoryWithSelection extends CategoryEditorRow {
    readonly id: number;
    readonly providerId: number;
}

@Component({
    selector: 'app-category-management-dialog',
    imports: [CategoryEditorComponent],
    template: `
        <app-category-editor
            [(categories)]="categories"
            subtitle="DIALOGS.XTREAM_CATEGORIES"
            [showLocks]="showLocks()"
            [isLoading]="isLoading()"
            [isSaving]="isSaving()"
            (saveRequested)="save()"
            (cancelled)="cancel()"
        />
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryManagementDialogComponent implements OnInit {
    private readonly dbService = inject(DatabaseService);
    private readonly dataSource = inject(XTREAM_DATA_SOURCE);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly sourceActivity = inject(SourceActivityService);
    private readonly parentalLock = inject(ParentalLockService);
    private readonly userDataStorage = inject(USER_DATA_STORAGE);
    private initialSelection = new Map<number, boolean>();
    private readonly notifications = inject(NotificationService);
    private readonly dialogRef = inject(
        MatDialogRef<CategoryManagementDialogComponent>
    );
    readonly data = inject<CategoryManagementDialogData>(MAT_DIALOG_DATA);
    private readonly logger = createLogger('CategoryManagementDialog');

    /**
     * Lock toggles, only once the lock store has been read: a draft built
     * from the empty fail-closed snapshot would, if storage recovered by
     * Save, replace the real locks with nothing.
     */
    readonly showLocks = signal(false);
    readonly isLoading = signal(true);
    readonly isSaving = signal(false);
    readonly categories = signal<CategoryWithSelection[]>([]);

    constructor() {
        // The PIN gate only covers opening: a relock (idle timer, Lock now)
        // while the editor is open must take its locked names and its
        // lock-rewriting Save away too.
        effect(() => {
            if (this.parentalLock.active()) {
                this.dialogRef.close(false);
            }
        });
    }

    async ngOnInit(): Promise<void> {
        await this.loadCategories();
    }

    private async loadCategories(): Promise<void> {
        try {
            const type = this.getDbType();
            this.showLocks.set(
                this.parentalLock.enabled() &&
                    (await this.parentalLock.ensureLocksReadable())
            );
            const allCategories = await this.waitForCategories(type);
            // The renderer's lock store is authoritative; the row's `locked`
            // column is only its SQLite mirror.
            const lockedIds = new Set(
                this.parentalLock.lockedXtreamIds(this.data.playlistId, type)
            );
            this.initialSelection = new Map(
                allCategories.map((category) => [
                    category.xtream_id,
                    !category.hidden,
                ])
            );
            this.categories.set(
                allCategories.map((c) => ({
                    id: c.id,
                    providerId: c.xtream_id,
                    name: c.name,
                    count: this.data.itemCounts.get(c.id) ?? 0,
                    selected: !c.hidden,
                    lockedDraft: lockedIds.has(c.xtream_id),
                }))
            );
        } catch (error) {
            this.logger.error('Error loading categories', error);
        } finally {
            this.isLoading.set(false);
        }
    }

    private async waitForCategories(
        type: 'live' | 'movies' | 'series'
    ): Promise<XCategoryFromDb[]> {
        const retryDeadlineMs = Date.now() + 10000;
        const expectedCategoryCount = this.data.itemCounts.size;

        while (true) {
            const categories = await this.dataSource.getAllCategories(
                this.data.playlistId,
                type
            );

            if (
                categories.length > 0 ||
                expectedCategoryCount === 0 ||
                Date.now() >= retryDeadlineMs
            ) {
                return categories;
            }

            await new Promise((resolve) => setTimeout(resolve, 250));
        }
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

    async save(): Promise<void> {
        this.isSaving.set(true);
        try {
            const categories = this.categories();
            if (this.runtime.supportsXtreamSqliteDataSource) {
                await this.sourceActivity.runWhenIdle(
                    this.data.playlistId,
                    async () => {
                        if (
                            this.dialogRef.getState() === MatDialogState.OPEN &&
                            !this.parentalLock.active()
                        ) {
                            await this.saveDraft(categories);
                        }
                    }
                );
            } else {
                await this.saveDraft(categories);
            }
        } finally {
            this.isSaving.set(false);
        }
    }

    private async saveDraft(
        categories: CategoryWithSelection[]
    ): Promise<void> {
        try {
            await this.saveVisibility(categories);
        } catch (error) {
            this.logger.error('Error saving category visibility', error);
            this.notifications.error('XTREAM.CATEGORY_MANAGEMENT.SAVE_FAILED');
            return;
        }
        if (!(await this.saveLocks(categories))) {
            this.notifications.error('PARENTAL_LOCK.SAVE_FAILED');
            return;
        }
        this.dialogRef.close(true);
    }

    private async saveVisibility(
        categories: CategoryWithSelection[]
    ): Promise<void> {
        if (!this.runtime.supportsXtreamSqliteDataSource) {
            const changes = new Map(
                categories
                    .filter(
                        (row) =>
                            row.selected !==
                            this.initialSelection.get(row.providerId)
                    )
                    .map((row) => [row.providerId, row.selected])
            );
            editPwaXtreamVisibility(
                this.userDataStorage,
                this.data.playlistId,
                this.getDbType(),
                changes
            );
            for (const [id, selected] of changes)
                this.initialSelection.set(id, selected);
            return;
        }
        const toHide = categories.filter((c) => !c.selected).map((c) => c.id);
        const toShow = categories.filter((c) => c.selected).map((c) => c.id);
        if (toHide.length > 0) {
            if (
                !(await this.dbService.updateCategoryVisibility(
                    toHide,
                    true,
                    true
                ))
            )
                throw new Error('Saving explicit category visibility failed.');
        }
        if (toShow.length > 0) {
            if (
                !(await this.dbService.updateCategoryVisibility(
                    toShow,
                    false,
                    true
                ))
            )
                throw new Error('Saving explicit category visibility failed.');
        }
    }

    /** False only when a lock write was attempted and did not persist. */
    private async saveLocks(
        categories: CategoryWithSelection[]
    ): Promise<boolean> {
        // A relock while the visibility writes ran closed the dialog: its
        // lock draft is dropped. The lock store refuses a removal that
        // still commits after a relock (it checks at commit time).
        if (!this.showLocks() || this.parentalLock.active()) {
            return true;
        }
        try {
            const saved = await this.parentalLock.setXtreamLocks(
                this.data.playlistId,
                this.getDbType(),
                categories.filter((c) => c.lockedDraft).map((c) => c.providerId)
            );
            if (!saved) {
                this.logger.error('Category locks were not saved');
            }
            return saved;
        } catch (error) {
            this.logger.error('Error saving category locks', error);
            return false;
        }
    }

    cancel(): void {
        this.dialogRef.close(false);
    }
}
