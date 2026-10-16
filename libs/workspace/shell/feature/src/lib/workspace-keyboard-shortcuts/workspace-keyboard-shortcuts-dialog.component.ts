import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { KeyboardShortcutDisplayGroup } from '@iptvnator/portal/shared/util';
import {
    DialogHeaderEndDirective,
    DialogShellComponent,
} from '@iptvnator/ui/components';

export interface WorkspaceKeyboardShortcutsDialogData {
    groups: readonly KeyboardShortcutDisplayGroup[];
    platformIcon: string;
    platformLabelKey: string;
}

@Component({
    selector: 'app-workspace-keyboard-shortcuts-dialog',
    imports: [
        DialogHeaderEndDirective,
        DialogShellComponent,
        MatIconModule,
        TranslatePipe,
    ],
    templateUrl: './workspace-keyboard-shortcuts-dialog.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrl: './workspace-keyboard-shortcuts-dialog.component.scss',
})
export class WorkspaceKeyboardShortcutsDialogComponent {
    readonly data =
        inject<WorkspaceKeyboardShortcutsDialogData>(MAT_DIALOG_DATA);

    readonly groups = this.data.groups;
}
