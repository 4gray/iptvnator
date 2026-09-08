import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';

export interface ConfirmDialogData {
    title: string;
    message: string;
    width?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Run the action in the dialog; only Close/backdrop/Escape dismiss it. */
    keepOpenOnConfirm?: boolean;
    onConfirm: () => void;
}

@Component({
    imports: [MatButtonModule, MatDialogModule, TranslateModule],
    template: `
        <h2 mat-dialog-title>
            {{ dialogData.title }}
        </h2>
        <mat-dialog-content class="mat-typography">
            {{ dialogData.message }}
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-button mat-dialog-close cdkFocusInitial>
                {{ dialogData.cancelLabel || 'NO' | translate }}
            </button>
            @if (dialogData.keepOpenOnConfirm) {
                <button
                    mat-flat-button
                    (click)="dialogData.onConfirm()"
                    color="primary"
                >
                    {{ dialogData.confirmLabel || 'YES' | translate }}
                </button>
            } @else {
                <button
                    mat-flat-button
                    [mat-dialog-close]="true"
                    color="primary"
                >
                    {{ dialogData.confirmLabel || 'YES' | translate }}
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
}
