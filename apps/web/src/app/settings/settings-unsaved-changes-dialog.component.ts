import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import {
    DialogFooterDirective,
    DialogShellComponent,
} from '@iptvnator/ui/components';

/** What the user picked; closing via backdrop/Esc yields `undefined` = stay. */
export type SettingsUnsavedChangesChoice = 'save' | 'discard';

export interface SettingsUnsavedChangesDialogData {
    /** Save-and-leave is offered only while the form can actually be saved. */
    canSave: boolean;
}

/**
 * Asked once, when the user is about to leave the settings area with staged
 * edits. Section switches never show this — the shared form survives them.
 * "Cancel" (stay) carries the initial focus so Enter is always the safe
 * choice. Labels are single verbs so the row fits one line in every locale.
 */
@Component({
    imports: [
        DialogFooterDirective,
        DialogShellComponent,
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        TranslateModule,
    ],
    styles: [
        `
            .unsaved-dialog__message {
                margin: 0;
            }

            .unsaved-dialog__invalid-hint {
                display: flex;
                align-items: center;
                gap: 8px;
                margin: 12px 0 0;
                color: var(--mat-sys-error);
                font-size: 0.86rem;

                mat-icon {
                    font-size: 18px;
                    width: 18px;
                    height: 18px;
                }
            }
        `,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    // The shell stacks the three actions on a phone, one full-width button
    // per row in DOM order, so a long translation never wraps the row.
    template: `
        <app-dialog-shell
            icon="edit_note"
            [heading]="'SETTINGS.UNSAVED_DIALOG_TITLE' | translate"
        >
            <p class="unsaved-dialog__message">
                {{ 'SETTINGS.UNSAVED_DIALOG_MESSAGE' | translate }}
            </p>
            @if (!data.canSave) {
                <p class="unsaved-dialog__invalid-hint">
                    <mat-icon>error_outline</mat-icon>
                    <span>{{
                        'SETTINGS.UNSAVED_DIALOG_INVALID_HINT' | translate
                    }}</span>
                </p>
            }
            <div appDialogFooter class="unsaved-dialog__actions">
                <button
                    mat-button
                    mat-dialog-close
                    cdkFocusInitial
                    data-test-id="unsaved-dialog-stay"
                >
                    {{ 'CANCEL' | translate }}
                </button>
                <button
                    mat-button
                    class="app-destructive-button"
                    [mat-dialog-close]="'discard'"
                    data-test-id="unsaved-dialog-discard"
                >
                    {{ 'SETTINGS.UNSAVED_DIALOG_DISCARD' | translate }}
                </button>
                <button
                    mat-flat-button
                    [disabled]="!data.canSave"
                    [mat-dialog-close]="'save'"
                    data-test-id="unsaved-dialog-save"
                >
                    {{ 'SETTINGS.UNSAVED_DIALOG_SAVE' | translate }}
                </button>
            </div>
        </app-dialog-shell>
    `,
})
export class SettingsUnsavedChangesDialogComponent {
    readonly data = inject<SettingsUnsavedChangesDialogData>(MAT_DIALOG_DATA);
}
