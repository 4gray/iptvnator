import { Component, inject, Input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MomentDatePipe } from '@iptvnator/pipes';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgProgram } from 'shared-interfaces';
import { EpgItemDescriptionComponent } from '../epg-item-description/epg-item-description.component';

@Component({
    imports: [MomentDatePipe, MatIcon, MatTooltip, TranslatePipe],
    selector: 'app-epg-list-item',
    templateUrl: './epg-list-item.component.html',
    styleUrls: ['./epg-list-item.component.scss'],
})
export class EpgListItemComponent {
    private dialog = inject(MatDialog);

    /** EPG Program to render */
    @Input() item!: EpgProgram;

    /** Actual time */
    @Input() timeNow!: string;

    /** Aviability of the timeshift function until date */
    @Input() timeshiftUntil!: string;

    /**
     * Opens the dialog with details about the selected program
     * @param program selected epg program
     */
    showDescription(program: EpgProgram): void {
        this.dialog.open(EpgItemDescriptionComponent, {
            data: program,
        });
    }
}
