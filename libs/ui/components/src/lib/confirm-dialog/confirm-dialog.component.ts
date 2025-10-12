import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';

export interface ConfirmDialogData {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
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
            <button mat-button mat-dialog-close cdkFocusInitial color="accent">
                {{ dialogData.cancelLabel || 'NO' | translate }}
            </button>
            <button mat-flat-button [mat-dialog-close]="true" color="accent">
                {{ dialogData.confirmLabel || 'YES' | translate }}
            </button>
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
