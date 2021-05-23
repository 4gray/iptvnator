import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Component, Inject } from '@angular/core';

export interface ConfirmDialogData {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
}

@Component({
    selector: 'app-confirm-dialog',
    templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent {
    /** Contains meta information to show in the dialog */
    dialogData;

    /** Creates an instance of ConfirmDialogComponent
     * @param data dialog data
     */
    constructor(@Inject(MAT_DIALOG_DATA) data: ConfirmDialogData) {
        this.dialogData = data;
    }
}
