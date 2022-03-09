import { ConfirmDialogComponent } from './../shared/components/confirm-dialog/confirm-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { Injectable } from '@angular/core';
import { ConfirmDialogData } from '../shared/components/confirm-dialog/confirm-dialog.component';

@Injectable({
    providedIn: 'root',
})
export class DialogService {
    constructor(private dialog: MatDialog) {}

    /**
     * Opens the confirm dialog with provided data
     * @param data dialog meta info
     */
    openConfirmDialog(data: ConfirmDialogData): void {
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
            data,
            width: '300px',
        });
        dialogRef
            .afterClosed()
            .subscribe((result) => (result ? data.onConfirm() : null));
    }
}
