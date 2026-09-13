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
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

export interface GroupManagementDialogGroup {
    readonly count: number;
    readonly key: string;
}

export interface GroupManagementDialogData {
    readonly groups: GroupManagementDialogGroup[];
    readonly hiddenGroupTitles: string[];
    /** Parental lock: present only while the lock feature is enabled. */
    readonly lockedGroupTitles?: string[];
}

export interface GroupManagementDialogResult {
    readonly hiddenGroupTitles: string[];
    /** Absent when the dialog offered no lock toggles. */
    readonly lockedGroupTitles?: string[];
}

interface GroupWithSelection extends GroupManagementDialogGroup {
    readonly selected: boolean;
    readonly locked: boolean;
}

@Component({
    selector: 'app-group-management-dialog',
    imports: [
        MatDialogModule,
        MatButtonModule,
        MatCheckboxModule,
        MatIconModule,
        MatTooltipModule,
        TitleCasePipe,
        TranslatePipe,
    ],
    templateUrl: './group-management-dialog.component.html',
    styleUrl: './group-management-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupManagementDialogComponent {
    private readonly dialogRef = inject(
        MatDialogRef<
            GroupManagementDialogComponent,
            GroupManagementDialogResult | undefined
        >
    );
    readonly data = inject<GroupManagementDialogData>(MAT_DIALOG_DATA);

    readonly showLocks = this.data.lockedGroupTitles !== undefined;
    readonly searchTerm = signal('');
    readonly groups = signal<GroupWithSelection[]>(
        this.data.groups.map((group) => ({
            ...group,
            selected: !this.data.hiddenGroupTitles.includes(group.key),
            locked: (this.data.lockedGroupTitles ?? []).includes(group.key),
        }))
    );
    readonly lockedCount = computed(
        () => this.groups().filter((group) => group.locked).length
    );

    readonly filteredGroups = computed(() => {
        const term = this.searchTerm().trim().toLowerCase();

        if (!term) {
            return this.groups();
        }

        return this.groups().filter((group) =>
            group.key.toLowerCase().includes(term)
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

    toggleLock(group: GroupWithSelection, event?: Event): void {
        event?.stopPropagation();
        this.groups.update((groups) =>
            groups.map((current) =>
                current.key === group.key
                    ? { ...current, locked: !current.locked }
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

        this.dialogRef.close({
            hiddenGroupTitles,
            ...(this.showLocks
                ? {
                      lockedGroupTitles: this.groups()
                          .filter((group) => group.locked)
                          .map((group) => group.key),
                  }
                : {}),
        });
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }
}
