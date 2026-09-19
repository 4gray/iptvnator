import { TitleCasePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    categorySearchPredicate,
    normalizeCategorySearch,
} from '@iptvnator/portal/shared/util';

export interface GroupManagementDialogGroup {
    readonly count: number;
    readonly key: string;
}

export interface GroupManagementDialogData {
    readonly groups: GroupManagementDialogGroup[];
    readonly hiddenGroupTitles: string[];
}

interface GroupWithSelection extends GroupManagementDialogGroup {
    readonly selected: boolean;
}

@Component({
    selector: 'app-group-management-dialog',
    imports: [
        MatDialogModule,
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        TitleCasePipe,
        TranslatePipe,
    ],
    templateUrl: './group-management-dialog.component.html',
    styleUrl: './group-management-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupManagementDialogComponent {
    private readonly dialogRef = inject(
        MatDialogRef<GroupManagementDialogComponent, string[] | undefined>
    );
    readonly data = inject<GroupManagementDialogData>(MAT_DIALOG_DATA);

    readonly searchTerm = signal('');
    readonly groups = signal<GroupWithSelection[]>(
        this.data.groups.map((group) => ({
            ...group,
            selected: !this.data.hiddenGroupTitles.includes(group.key),
        }))
    );

    readonly filteredGroups = computed(() => {
        const query = this.searchTerm();

        if (!query.trim()) {
            return this.groups();
        }

        const matches = categorySearchPredicate(query, '', 'all');
        return this.groups().filter((group) =>
            matches(normalizeCategorySearch(group.key))
        );
    });

    readonly selectedCount = computed(
        () => this.groups().filter((group) => group.selected).length
    );
    readonly totalCount = computed(() => this.groups().length);
    readonly allSelected = computed(
        () =>
            this.groups().length > 0 &&
            this.groups().every((group) => group.selected)
    );

    clearSearch(): void {
        this.searchTerm.set('');
    }

    toggleGroup(group: GroupWithSelection): void {
        this.groups.update((groups) =>
            groups.map((current) =>
                current.key === group.key
                    ? { ...current, selected: !current.selected }
                    : current
            )
        );
    }

    selectAll(): void {
        this.groups.update((groups) =>
            groups.map((group) => ({ ...group, selected: true }))
        );
    }

    deselectAll(): void {
        this.groups.update((groups) =>
            groups.map((group) => ({ ...group, selected: false }))
        );
    }

    save(): void {
        const hiddenGroupTitles = this.groups()
            .filter((group) => !group.selected)
            .map((group) => group.key);

        this.dialogRef.close(hiddenGroupTitles);
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }
}
