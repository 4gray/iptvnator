import { inject, Injectable } from '@angular/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import {
    TrailerDialogComponent,
    type TrailerDialogData,
} from './trailer-dialog.component';

export const TRAILER_DIALOG_PANEL_CLASS = 'app-trailer-dialog-panel';

/** Opens the trailer modal at one width for every details page. */
@Injectable({ providedIn: 'root' })
export class TrailerDialogService {
    private readonly dialog = inject(MatDialog);

    open(data: TrailerDialogData): MatDialogRef<TrailerDialogComponent> {
        return this.dialog.open(TrailerDialogComponent, {
            data,
            width: 'min(880px, calc(100vw - 48px))',
            maxWidth: '880px',
            autoFocus: 'dialog',
            panelClass: TRAILER_DIALOG_PANEL_CLASS,
        });
    }
}
