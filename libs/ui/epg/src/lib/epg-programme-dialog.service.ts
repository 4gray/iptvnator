import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import {
    EpgItemDescriptionComponent,
    EpgItemDialogAction,
    EpgItemDialogData,
} from './epg-list/epg-item-description/epg-item-description.component';

/**
 * Opens the shared programme-details dialog and returns the chosen action.
 * Extracted so any EPG surface (the timeline today, a list view later) can open
 * it the same way and react to `live` / `timeshift`.
 */
@Injectable({ providedIn: 'root' })
export class EpgProgrammeDialogService {
    private readonly dialog = inject(MatDialog);

    open(data: EpgItemDialogData): Observable<EpgItemDialogAction | undefined> {
        return this.dialog
            .open(EpgItemDescriptionComponent, { width: '540px', data })
            .afterClosed();
    }
}
