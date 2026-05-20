import { Component, inject } from '@angular/core';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { KeyboardShortcutDisplayGroup } from '@iptvnator/portal/shared/util';

export interface WorkspaceKeyboardShortcutsDialogData {
    groups: readonly KeyboardShortcutDisplayGroup[];
    platformIcon: string;
    platformLabelKey: string;
}

@Component({
    selector: 'app-workspace-keyboard-shortcuts-dialog',
    imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
    templateUrl: './workspace-keyboard-shortcuts-dialog.component.html',
    styleUrl: './workspace-keyboard-shortcuts-dialog.component.scss',
})
export class WorkspaceKeyboardShortcutsDialogComponent {
    private readonly dialogRef = inject(
        MatDialogRef<WorkspaceKeyboardShortcutsDialogComponent>
    );
    readonly data =
        inject<WorkspaceKeyboardShortcutsDialogData>(MAT_DIALOG_DATA);

    readonly groups = this.data.groups;

    close(): void {
        this.dialogRef.close();
    }
}
