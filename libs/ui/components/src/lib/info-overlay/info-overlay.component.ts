import { NgStyle } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { MomentDatePipe } from '@iptvnator/pipes';
import { TranslatePipe } from '@ngx-translate/core';
import moment from 'moment';
import { Channel, EpgProgram } from 'shared-interfaces';

@Component({
    imports: [MomentDatePipe, NgStyle, TranslatePipe],
    selector: 'app-info-overlay',
    templateUrl: './info-overlay.component.html',
    styleUrls: ['./info-overlay.component.scss'],
})
export class InfoOverlayComponent implements OnChanges {
    /** Active channel */
    @Input() channel: Channel | undefined;

    /** Current EPG program */
    @Input() epgProgram: EpgProgram | undefined;

    /** Visibility flag of the overlay popup  */
    isVisible = false;

    /** Program duration */
    generalDuration!: number;

    /** Finished duration */
    finishedDuration!: number;

    /** Program start time */
    start: string | undefined;

    /** Program end time */
    stop: string | undefined;

    /** Timeout for the overlay visibility */
    private currentTimeout: ReturnType<typeof setTimeout> | undefined;

    /**
     * Calculates the necessary information for the visualization in the overview popup
     * @param changes component input changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes['channel'] && changes['channel'].currentValue) {
            clearTimeout(this.currentTimeout);
            this.isVisible = true;
            this.currentTimeout = setTimeout(() => {
                this.isVisible = false;
            }, 10000);
        }
        if (changes['epgProgram']) {
            if (changes['epgProgram'].currentValue) {
                const { stop, start } = changes['epgProgram'].currentValue;
                this.setProgramDuration(start, stop);
            } else {
                // Reset EPG data when no program is available
                this.start = undefined;
                this.stop = undefined;
                this.generalDuration = 0;
                this.finishedDuration = 0;
            }
        }
    }

    /**
     * Calculates and sets the duration of the program for the progress bar visualization
     * @param start program start time
     * @param stop program stop time
     */
    setProgramDuration(start: string | number, stop: string | number): void {
        const stopMoment = moment(stop, 'YYYYMMDDHHmm ZZ');
        const startMoment = moment(start, 'YYYYMMDDHHmm ZZ');
        this.stop = stopMoment.toISOString();
        this.start = startMoment.toISOString();
        const timeNow = moment(Date.now());

        this.generalDuration = moment
            .duration(stopMoment.diff(startMoment))
            .asMilliseconds();

        this.finishedDuration = moment
            .duration(stopMoment.diff(timeNow))
            .asMilliseconds();
    }

    /**
     * Manually shows the overlay (triggered by user action like 'I' key or info button)
     * Toggles visibility if already shown, or shows for 10 seconds if hidden
     */
    showOverlay(): void {
        if (this.isVisible) {
            // If already visible, hide it (toggle behavior)
            clearTimeout(this.currentTimeout);
            this.isVisible = false;
        } else {
            // Show overlay for 10 seconds
            clearTimeout(this.currentTimeout);
            this.isVisible = true;
            this.currentTimeout = setTimeout(() => {
                this.isVisible = false;
            }, 10000);
        }
    }
}
