import { inject, Injectable } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import {
    EpgItemDescriptionComponent,
    EpgItemDialogAction,
    EpgItemDialogData,
} from './epg-item-description/epg-item-description.component';

/**
 * The one open config for the programme dialog. The panel class scopes the
 * dialog's surface overrides, so they never leak into another open dialog.
 */
export const EPG_PROGRAMME_DIALOG_CONFIG = {
    width: '540px',
    panelClass: 'epg-programme-dialog-panel',
} as const satisfies MatDialogConfig;

/**
 * Opens the shared programme-details dialog and returns the chosen action.
 * Every EPG surface (timeline, list, guide, channel rows) opens it here, so
 * the dialog has the same width wherever it is opened from.
 */
@Injectable({ providedIn: 'root' })
export class EpgProgrammeDialogService {
    private readonly dialog = inject(MatDialog);

    open(data: EpgItemDialogData): Observable<EpgItemDialogAction | undefined> {
        return this.dialog
            .open<
                EpgItemDescriptionComponent,
                EpgItemDialogData,
                EpgItemDialogAction
            >(EpgItemDescriptionComponent, {
                ...EPG_PROGRAMME_DIALOG_CONFIG,
                data,
            })
            .afterClosed();
    }
}
