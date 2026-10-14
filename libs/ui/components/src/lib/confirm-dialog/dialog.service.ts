import { inject, Injectable } from '@angular/core';
import { LazyMatDialog } from '../lazy-dialog/lazy-mat-dialog';
import type {
    ConfirmDialogComponent,
    ConfirmDialogData,
} from './confirm-dialog.component';

@Injectable({
    providedIn: 'root',
})
export class DialogService {
    private readonly lazyDialog = inject(LazyMatDialog);

    /**
     * The dynamic import; a field so specs can substitute it. The component
     * loads with the first confirmation: this service is created with the
     * app, so a static import would put the component, Material's dialog
     * and buttons on the initial path.
     */
    loadConfirmDialog = () => import('./confirm-dialog.component');

    /**
     * Opens the confirm dialog with provided data. The returned promise
     * settles once the dialog is open; a failed chunk load is logged, and
     * the action is not performed.
     * @param data dialog meta info
     */
    async openConfirmDialog(data: ConfirmDialogData): Promise<void> {
        let dialogModule: Awaited<ReturnType<typeof this.loadConfirmDialog>>;
        let dialog: Awaited<ReturnType<LazyMatDialog['resolve']>>;
        try {
            [dialog, dialogModule] = await Promise.all([
                this.lazyDialog.resolve(),
                this.loadConfirmDialog(),
            ]);
        } catch (error) {
            console.error('Could not open the confirmation dialog:', error);
            return;
        }
        const dialogRef = dialog.open<
            ConfirmDialogComponent,
            ConfirmDialogData
        >(dialogModule.ConfirmDialogComponent, {
            data,
            // Wide enough for two side-by-side action buttons with
            // translated labels; 300px forced them to wrap into a
            // vertical stack.
            width: data.width ?? '420px',
            maxWidth: 'calc(100vw - 32px)',
        });
        dialogRef
            .afterClosed()
            .subscribe((result) =>
                result && !data.keepOpenOnConfirm ? data.onConfirm() : null
            );
    }
}
