import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { differenceInMinutes } from 'date-fns';
import { startWith } from 'rxjs';
import { EpgProgram } from 'shared-interfaces';

type EpgItemDialogData = EpgProgram & {
    channelName?: string | null;
    channel_name?: string | null;
    display_name?: string | null;
};

@Component({
    selector: 'app-epg-item-description',
    templateUrl: './epg-item-description.component.html',
    styleUrls: ['./epg-item-description.component.scss'],
    imports: [DatePipe, MatButtonModule, MatDialogModule, TranslatePipe],
})
export class EpgItemDescriptionComponent {
    dialogData = inject<EpgItemDialogData>(MAT_DIALOG_DATA);
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    epgProgram: EpgProgram;
    channelName: string | null = null;
    duration: string | null = null;
    readonly currentLocale = computed(() => {
        this.languageTick();
        return normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
    });

    constructor() {
        this.epgProgram = this.dialogData;
        // Check multiple possible field names for channel name
        this.channelName = this.dialogData.channelName
            || this.dialogData.channel_name
            || this.dialogData.display_name
            || null;
        this.duration = this.calculateDuration();
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
