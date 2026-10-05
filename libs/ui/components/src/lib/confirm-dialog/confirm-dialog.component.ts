import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';

/**
 * `destructive` renders the confirm action with the app-wide error styling
 * (`.app-destructive-button`). Use it whenever confirming removes or discards
 * user data; Material's `warn` color input has no effect with the M3 theme.
 */
export type ConfirmDialogTone = 'default' | 'destructive';

export interface ConfirmDialogData {
    title: string;
    message: string;
    width?: string;
    /**
     * Translated verb that names the action ("Remove playlist", "Clear").
     * Required so a confirmation never falls back to an ambiguous "Yes".
     */
    confirmLabel: string;
    /** Translated dismiss label; defaults to "Cancel". */
    cancelLabel?: string;
    tone?: ConfirmDialogTone;
    /** Run the action in the dialog; only Close/backdrop/Escape dismiss it. */
    keepOpenOnConfirm?: boolean;
    onConfirm: () => void;
}

@Component({
    imports: [MatButtonModule, MatDialogModule, TranslateModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <h2 mat-dialog-title>
            {{ dialogData.title }}
        </h2>
        <mat-dialog-content class="mat-typography">
            {{ dialogData.message }}
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-button mat-dialog-close cdkFocusInitial>
                {{ dialogData.cancelLabel || ('CANCEL' | translate) }}
            </button>
            @if (dialogData.keepOpenOnConfirm) {
                <button
                    mat-flat-button
                    data-test-id="confirm-dialog-confirm"
                    [class.app-destructive-button]="isDestructive"
                    (click)="dialogData.onConfirm()"
                >
                    {{ dialogData.confirmLabel }}
                </button>
            } @else {
                <button
                    mat-flat-button
                    data-test-id="confirm-dialog-confirm"
                    [class.app-destructive-button]="isDestructive"
                    [mat-dialog-close]="true"
                >
                    {{ dialogData.confirmLabel }}
                </button>
            }
        </mat-dialog-actions>
    `,
})
export class ConfirmDialogComponent {
    readonly dialogData!: ConfirmDialogData;
    readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);

    constructor() {
        this.dialogData = this.data;
    }

    get isDestructive(): boolean {
        return this.dialogData.tone === 'destructive';
    }
}
