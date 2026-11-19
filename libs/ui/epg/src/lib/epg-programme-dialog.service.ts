import { inject, Injectable } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { EMPTY, finalize, Observable } from 'rxjs';
import { dialogSize } from '@iptvnator/ui/dialog/dialog-size';
import {
    EpgItemDescriptionComponent,
    EpgItemDialogAction,
    EpgItemDialogData,
} from './epg-item-description/epg-item-description.component';

/**
 * The one open config for the programme dialog: the dialog shell's `md`
 * preset, and a panel class that names the dialog's overlay pane.
 */
export const EPG_PROGRAMME_DIALOG_CONFIG = {
    ...dialogSize('md'),
    panelClass: 'epg-programme-dialog-panel',
} as const satisfies MatDialogConfig;
const OWNED_PANEL = 'epg-owned-programme-dialog';

/**
 * Opens the shared programme-details dialog and returns the chosen action.
 * Every EPG surface (timeline, list, guide, channel rows) opens it here, so
 * the dialog has the same width wherever it is opened from.
 */
@Injectable({ providedIn: 'root' })
export class EpgProgrammeDialogService {
    private readonly dialog = inject(MatDialog);

    ownedAfterClosed(focused: Element | null): Observable<unknown> | undefined {
        const owner = focused?.closest<HTMLElement>(
            `.${OWNED_PANEL} mat-dialog-container`
        );
        return owner
            ? this.dialog.getDialogById(owner.id)?.afterClosed()
            : undefined;
    }

    open(
        data: EpgItemDialogData,
        signal?: AbortSignal
    ): Observable<EpgItemDialogAction | undefined> {
        if (signal?.aborted) return EMPTY;
        const ref = this.dialog.open<
            EpgItemDescriptionComponent,
            EpgItemDialogData,
            EpgItemDialogAction
        >(EpgItemDescriptionComponent, {
            ...EPG_PROGRAMME_DIALOG_CONFIG,
            ...(signal && {
                panelClass: [
                    EPG_PROGRAMME_DIALOG_CONFIG.panelClass,
                    OWNED_PANEL,
                ],
            }),
            data,
        });
        if (!signal) return ref.afterClosed();
        const close = () => ref.close();
        signal.addEventListener('abort', close, { once: true });
        return ref
            .afterClosed()
            .pipe(finalize(() => signal.removeEventListener('abort', close)));
    }
}
