import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgProgram } from 'shared-interfaces';
import { format, differenceInMinutes } from 'date-fns';

@Component({
    selector: 'app-epg-item-description',
    templateUrl: './epg-item-description.component.html',
    styleUrls: ['./epg-item-description.component.scss'],
    imports: [MatButtonModule, MatDialogModule, TranslatePipe],
})
export class EpgItemDescriptionComponent {
    dialogData = inject<any>(MAT_DIALOG_DATA);

    epgProgram: EpgProgram;
    channelName: string | null = null;
    duration: string | null = null;

    constructor() {
        this.epgProgram = this.dialogData;
        // Check multiple possible field names for channel name
        this.channelName = this.dialogData.channelName
            || this.dialogData.channel_name
            || this.dialogData.display_name
            || null;
        this.duration = this.calculateDuration();
    }

    formatTime(dateStr: string): string {
        if (!dateStr) return '';
        try {
            return format(new Date(dateStr), 'HH:mm');
        } catch {
            return '';
        }
    }

    formatDate(dateStr: string): string {
        if (!dateStr) return '';
        try {
            return format(new Date(dateStr), 'EEEE, MMMM d');
        } catch {
            return '';
        }
    }

    private calculateDuration(): string | null {
        if (!this.epgProgram.start || !this.epgProgram.stop) return null;
        try {
            const start = new Date(this.epgProgram.start);
            const stop = new Date(this.epgProgram.stop);
            const mins = differenceInMinutes(stop, start);
            if (mins < 60) {
                return `${mins} min`;
            }
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
        } catch {
            return null;
        }
    }
}
