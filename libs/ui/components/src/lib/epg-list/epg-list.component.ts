import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MomentDatePipe } from '@iptvnator/pipes';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    selectActive,
    EpgActions,
} from 'm3u-state';
import moment from 'moment';
import { BehaviorSubject, combineLatest, map } from 'rxjs';
import { EpgService } from 'services';
import { EpgChannel, EpgProgram } from 'shared-interfaces';
import { EpgListItemComponent } from './epg-list-item/epg-list-item.component';

export interface EpgData {
    channel: EpgChannel;
    items: EpgProgram[];
}

const DATE_FORMAT = 'YYYY-MM-DD';

@Component({
    imports: [
        AsyncPipe,
        EpgListItemComponent,
        FormsModule,
        MatIcon,
        MatIconButton,
        MatTooltip,
        MomentDatePipe,
        TranslatePipe,
    ],
    selector: 'app-epg-list',
    templateUrl: './epg-list.component.html',
    styleUrls: ['./epg-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EpgListComponent implements OnInit {
    private readonly store = inject(Store);
    private readonly epgService = inject(EpgService);
    private readonly cdr = inject(ChangeDetectorRef);

    /** Channel info in EPG format */
    channel!: EpgChannel;

    /** Today as formatted date string */
    dateToday!: string;

    /** Array with EPG programs */
    items$ = this.epgService.currentEpgPrograms$;

    /** Object with epg programs for the active channel */
    programs!: {
        payload: EpgData;
    };

    /** EPG selected program */
    playingNow!: EpgProgram;

    /** Selected date */
    selectedDate!: string;

    /** Current time as formatted string */
    timeNow!: string;

    /** Timeshift availability date, based on tvg-rec value from the channel */
    readonly timeshiftUntil$ = this.store.select(selectActive).pipe(
        map((active) => {
            // Create EpgChannel with proper structure
            const displayNames = active?.name
                ? [{ lang: '', value: active.name }]
                : [];
            const icons = active?.tvg?.logo ? [{ src: active.tvg.logo }] : [];

            this.channel = {
                id: active?.tvg?.id || '',
                displayName: displayNames,
                url: active?.url ? [active.url] : [],
                icon: icons,
            };
            return (
                active?.tvg?.rec || active?.timeshift || active?.catchup?.days
            );
        }),
        map((value) => {
            const days = Number(value ?? 0) || 0;
            return moment().subtract(days, 'days').toISOString();
        })
    );

    private readonly selectedDate$ = new BehaviorSubject<string>(
        moment().format(DATE_FORMAT)
    );

    /** Filtered EPG programs based on selected date */
    filteredItems$ = combineLatest([this.items$, this.selectedDate$]).pipe(
        map(([items, selectedDate]) =>
            items
                .filter(
                    (item) =>
                        moment(item.start).format('YYYY-MM-DD') === selectedDate
                )
                .sort((a, b) => moment(a.start).diff(moment(b.start)))
        )
    );

    /**
     * Helper function to get channel display name
     */
    getChannelDisplayName(channel: EpgChannel): string {
        if (
            !channel ||
            !channel.displayName ||
            channel.displayName.length === 0
        ) {
            return '';
        }
        // Return first available display name
        return channel.displayName[0]?.value || '';
    }

    /**
     * Helper function to get channel icon
     */
    getChannelIcon(channel: EpgChannel): string {
        if (!channel || !channel.icon || channel.icon.length === 0) {
            return '';
        }
        // Return first available icon src
        return channel.icon[0]?.src || '';
    }

    /**
     * Subscribe for values from the store on component init
     */
    ngOnInit(): void {
        this.items$.subscribe((programs) => this.handleEpgData(programs));
        this.dateToday = moment().format(DATE_FORMAT);
        this.selectedDate$.next(this.dateToday);
    }

    /**
     * Handles incoming epg programs for the active channel from the main process
     * @param programs
     */
    handleEpgData(programs: EpgProgram[]): void {
        this.timeNow = new Date().toISOString();
        this.dateToday = moment().format(DATE_FORMAT);

        // Dispatch EPG availability flag
        this.store.dispatch(
            EpgActions.setEpgAvailableFlag({ value: programs.length > 0 })
        );

        if (programs.length > 0) {
            this.setPlayingNow();
        } else {
            this.channel = {} as EpgChannel;
            // Clear the current EPG program when no programs available
            this.store.dispatch(EpgActions.resetActiveEpgProgram());
        }

        // Trigger change detection for OnPush strategy
        this.cdr.markForCheck();
    }

    /**
     * Selects the program based on the active date
     */
    selectPrograms(programs: { payload: EpgData }): EpgProgram[] {
        const selectedDate = moment(this.dateToday).format('YYYY-MM-DD');
        return programs.payload?.items
            .filter(
                (item) =>
                    moment(item.start).format('YYYY-MM-DD') === selectedDate
            )
            .map((program) => ({
                ...program,
                start: program.start, // Keep ISO format
                stop: program.stop, // Keep ISO format
            }))
            .sort((a, b) => moment(a.start).diff(moment(b.start)));
    }

    /**
     * Changes the date to update the epg list with programs
     * @param direction direction to switch
     */
    changeDate(direction: 'next' | 'prev'): void {
        const newDate = moment(this.selectedDate$.value)
            [direction === 'next' ? 'add' : 'subtract'](1, 'days')
            .format(DATE_FORMAT);

        this.dateToday = newDate;
        this.selectedDate$.next(newDate);
    }

    /**
     * Sets the playing now variable based on the current time
     */
    setPlayingNow(): void {
        this.items$
            .pipe(
                map((items) =>
                    items.find((item) => {
                        const now = new Date().toISOString();
                        const start = new Date(item.start).toISOString();
                        const stop = new Date(item.stop).toISOString();
                        return now >= start && now <= stop;
                    })
                )
            )
            .subscribe((playingNow) => {
                this.playingNow = playingNow!;
                // Always dispatch the action, even when playingNow is null/undefined
                // This ensures the store is updated and old EPG data is cleared
                this.store.dispatch(
                    EpgActions.setCurrentEpgProgram({ program: this.playingNow })
                );
                // Trigger change detection for OnPush strategy
                this.cdr.markForCheck();
            });
    }

    /**
     * Sets the provided epg program as active and starts to play
     * @param program epg program to set
     * @param isLive live stream flag
     * @param timeshift timeshift flag
     */
    setEpgProgram(
        program: EpgProgram,
        isLive?: boolean,
        timeshift?: boolean
    ): void {
        if (isLive) {
            this.store.dispatch(EpgActions.resetActiveEpgProgram());
        } else {
            if (!timeshift) return;
            this.store.dispatch(EpgActions.setActiveEpgProgram({ program }));
        }
        this.playingNow = program;
        // Trigger change detection for OnPush strategy
        this.cdr.markForCheck();
    }

    /**
     * Calculates the progress percentage for the EPG program
     */
    calculateProgress(program: EpgProgram): number {
        const now = new Date().getTime();
        const start = new Date(program.start).getTime();
        const stop = new Date(program.stop).getTime();

        const total = stop - start;
        const elapsed = now - start;

        const progress = Math.min(100, Math.max(0, (elapsed / total) * 100));

        return progress;
    }

    /**
     * Check if program is currently playing
     */
    isProgramPlaying(program: EpgProgram): boolean {
        const isPlaying =
            this.timeNow >= program.start && this.timeNow <= program.stop;

        return isPlaying;
    }
}
