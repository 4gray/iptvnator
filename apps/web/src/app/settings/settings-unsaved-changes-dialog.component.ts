import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

/** What the user picked; closing via backdrop/Esc yields `undefined` = stay. */
export type SettingsUnsavedChangesChoice = 'save' | 'discard';

export interface SettingsUnsavedChangesDialogData {
    /** Save-and-leave is offered only while the form can actually be saved. */
    canSave: boolean;
}

/**
 * Asked once, when the user is about to leave the settings area with staged
 * edits. Section switches never show this — the shared form survives them.
 * "Keep editing" carries the initial focus so Enter is always the safe
 * choice.
 */
@Component({
    imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslateModule],
    styles: [
        `
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
    template: `
        <h2 mat-dialog-title>
            {{ 'SETTINGS.UNSAVED_DIALOG_TITLE' | translate }}
        </h2>
        <mat-dialog-content class="mat-typography">
            <p>{{ 'SETTINGS.UNSAVED_DIALOG_MESSAGE' | translate }}</p>
            @if (!data.canSave) {
                <p class="unsaved-dialog__invalid-hint">
                    <mat-icon>error_outline</mat-icon>
                    <span>{{
                        'SETTINGS.UNSAVED_DIALOG_INVALID_HINT' | translate
                    }}</span>
                </p>
            }
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button
                mat-button
                [mat-dialog-close]="'discard'"
                data-test-id="unsaved-dialog-discard"
            >
                {{ 'SETTINGS.UNSAVED_DIALOG_DISCARD' | translate }}
            </button>
            <button
                mat-button
                mat-dialog-close
                cdkFocusInitial
                data-test-id="unsaved-dialog-stay"
            >
                {{ 'SETTINGS.UNSAVED_DIALOG_STAY' | translate }}
            </button>
            <button
                mat-flat-button
                color="primary"
                [disabled]="!data.canSave"
                [mat-dialog-close]="'save'"
                data-test-id="unsaved-dialog-save"
            >
                {{ 'SETTINGS.UNSAVED_DIALOG_SAVE' | translate }}
            </button>
        </mat-dialog-actions>
    `,
})
export class SettingsUnsavedChangesDialogComponent {
    readonly data = inject<SettingsUnsavedChangesDialogData>(MAT_DIALOG_DATA);
}
