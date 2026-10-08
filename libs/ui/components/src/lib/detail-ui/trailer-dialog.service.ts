import { inject, Injectable } from '@angular/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { TrailerDialogState } from './trailer-dialog-state';
import {
    TrailerDialogComponent,
    type TrailerDialogData,
} from './trailer-dialog.component';

export const TRAILER_DIALOG_PANEL_CLASS = 'app-trailer-dialog-panel';

/** Opens the trailer modal at one width for every details page. */
@Injectable({ providedIn: 'root' })
export class TrailerDialogService {
    private readonly dialog = inject(MatDialog);
    private readonly state = inject(TrailerDialogState);

    open(data: TrailerDialogData): MatDialogRef<TrailerDialogComponent> {
        const ref = this.dialog.open(TrailerDialogComponent, {
            data,
            width: 'min(880px, calc(100vw - 48px))',
            maxWidth: '880px',
            autoFocus: 'dialog',
            panelClass: TRAILER_DIALOG_PANEL_CLASS,
        });
        this.state.opened();
        ref.afterClosed().subscribe(() => this.state.closed());
        return ref;
    }
}
