import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent, ConfirmDialogData } from 'components';

@Injectable({
    providedIn: 'root',
})
export class DialogService {
    private dialog = inject(MatDialog);

    /**
     * Opens the confirm dialog with provided data
     * @param data dialog meta info
     */
    openConfirmDialog(data: ConfirmDialogData): void {
        const dialogRef = this.dialog.open<
            ConfirmDialogComponent,
            ConfirmDialogData
        >(ConfirmDialogComponent, {
            data,
            width: '300px',
        });
        dialogRef
            .afterClosed()
            .subscribe((result) => (result ? data.onConfirm() : null));
    }
}
