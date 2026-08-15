import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
    ConfirmDialogComponent,
    ConfirmDialogData,
} from './confirm-dialog.component';

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
            // Wide enough for two side-by-side action buttons with translated
            // labels; 300px forced them to wrap into a vertical stack.
            width: data.width ?? '420px',
            maxWidth: 'calc(100vw - 32px)',
        });
        dialogRef
            .afterClosed()
            .subscribe((result) => (result ? data.onConfirm() : null));
    }
}
