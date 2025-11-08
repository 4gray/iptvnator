import { AsyncPipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import { MomentDatePipe } from '@iptvnator/pipes';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import {
    resetActiveEpgProgram,
    selectActive,
    setActiveEpgProgram,
    setCurrentEpgProgram,
    setEpgAvailableFlag,
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
        MatDivider,
        MatIcon,
        MatIconButton,
        MatListModule,
        MatTooltip,
        MomentDatePipe,
        TranslatePipe,
    ],
    selector: 'app-epg-list',
    templateUrl: './epg-list.component.html',
    styleUrls: ['./epg-list.component.scss'],
})
export class EpgListComponent implements OnInit {
    private readonly store = inject(Store);
    private readonly epgService = inject(EpgService);

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
            setEpgAvailableFlag({ value: programs.length > 0 })
        );

        if (programs.length > 0) {
            this.setPlayingNow();
        } else {
            this.channel = {} as EpgChannel;
            // Clear the current EPG program when no programs available
            this.store.dispatch(resetActiveEpgProgram());
        }
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
                if (this.playingNow) {
                    this.store.dispatch(
                        setCurrentEpgProgram({ program: this.playingNow })
                    );
                }
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
            this.store.dispatch(resetActiveEpgProgram());
        } else {
            if (!timeshift) return;
            this.store.dispatch(setActiveEpgProgram({ program }));
        }
        this.playingNow = program;
    }
}
