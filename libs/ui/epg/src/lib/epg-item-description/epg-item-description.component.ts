import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { normalizeDateLocale } from '@iptvnator/pipes';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { differenceInMinutes } from 'date-fns';
import { startWith } from 'rxjs';
import { EpgProgram } from '@iptvnator/shared/interfaces';

export type EpgItemDialogAction = 'live' | 'timeshift' | 'record';

export type EpgItemDialogData = EpgProgram & {
    channelName?: string | null;
    channel_name?: string | null;
    display_name?: string | null;
    /** Channel logo shown in the hero (falls back to a glyph when absent). */
    channelLogo?: string | null;
    /** State-aware primary action; closes the dialog with this value. */
    primaryAction?: EpgItemDialogAction | null;
    /** Show a "catch-up unavailable" note instead of an action button. */
    archiveUnavailableNote?: boolean;
    /** Allow scheduling this current or future programme for recording. */
    recordingAvailable?: boolean;
};

@Component({
    selector: 'app-epg-item-description',
    templateUrl: './epg-item-description.component.html',
    styleUrls: ['./epg-item-description.component.scss'],
    imports: [DatePipe, MatDialogModule, MatIcon, TranslatePipe],
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
    channelLogo: string | null = null;
    /** Set when the logo image fails to load → falls back to the glyph. */
    logoFailed = false;
    duration: string | null = null;
    primaryAction: EpgItemDialogAction | null = null;
    archiveUnavailableNote = false;
    recordingAvailable = false;
    /** ms timestamps for the date pipe (prefer unix timestamp when present). */
    startMs = 0;
    stopMs = 0;
    readonly currentLocale = computed(() => {
        this.languageTick();
        return normalizeDateLocale(
            this.translate.currentLang || this.translate.defaultLang
        );
    });

    constructor() {
        this.epgProgram = this.dialogData;
        // Check multiple possible field names for channel name
        this.channelName =
            this.dialogData.channelName ||
            this.dialogData.channel_name ||
            this.dialogData.display_name ||
            null;
        // Prefer the channel logo; fall back to the programme/EPG icon
        // (M3U playlists without tvg-logo still get an icon from the EPG feed).
        this.channelLogo =
            this.dialogData.channelLogo?.trim() ||
            this.epgProgram.iconUrl?.trim() ||
            null;
        this.duration = this.calculateDuration();
        this.primaryAction = this.dialogData.primaryAction ?? null;
        this.archiveUnavailableNote =
            this.dialogData.archiveUnavailableNote ?? false;
        this.recordingAvailable = this.dialogData.recordingAvailable ?? false;
        this.startMs = toMs(
            this.epgProgram.start,
            this.epgProgram.startTimestamp
        );
        this.stopMs = toMs(this.epgProgram.stop, this.epgProgram.stopTimestamp);
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
            return remainingMins > 0
                ? `${hours}h ${remainingMins}m`
                : `${hours}h`;
        } catch {
            return null;
        }
    }
}

function toMs(iso: string, timestamp?: number | null): number {
    if (Number.isFinite(timestamp) && Number(timestamp) > 0) {
        return Number(timestamp) * 1000;
    }
    return Date.parse(iso);
}
