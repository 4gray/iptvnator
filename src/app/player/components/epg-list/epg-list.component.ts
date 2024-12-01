import { AsyncPipe } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import moment from 'moment';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { EPG_GET_PROGRAM_DONE } from '../../../../../shared/ipc-commands';
import { DataService } from '../../../services/data.service';
import { EpgService } from '../../../services/epg.service';
import { MomentDatePipe } from '../../../shared/pipes/moment-date.pipe';
import {
    resetActiveEpgProgram,
    setActiveEpgProgram,
    setCurrentEpgProgram,
} from '../../../state/actions';
import { selectActive } from '../../../state/selectors';
import { EpgChannel } from '../../models/epg-channel.model';
import { EpgProgram } from '../../models/epg-program.model';
import { EpgListItemComponent } from './epg-list-item/epg-list-item.component';

export interface EpgData {
    channel: EpgChannel;
    items: EpgProgram[];
}

const DATE_FORMAT = 'YYYY-MM-DD';

@Component({
    standalone: true,
    imports: [
        AsyncPipe,
        EpgListItemComponent,
        FormsModule,
        MatButtonModule,
        MatDividerModule,
        MatIconModule,
        MatListModule,
        MatTooltipModule,
        MomentDatePipe,
        TranslateModule,
    ],
    selector: 'app-epg-list',
    templateUrl: './epg-list.component.html',
    styleUrls: ['./epg-list.component.scss'],
})
export class EpgListComponent {
    /** Channel info in EPG format */
    channel: EpgChannel;

    /** Today as formatted date string */
    dateToday: string;

    /** Array with EPG programs */
    items$ = this.epgService.currentEpgPrograms$;

    /** Object with epg programs for the active channel */
    programs: {
        payload: EpgData;
    };

    /** EPG selected program */
    playingNow: EpgProgram;

    /** Selected date */
    selectedDate: string;

    /** Current time as formatted string */
    timeNow: string;

    /** Timeshift availability date, based on tvg-rec value from the channel */
    timeshiftUntil$: Observable<string>;

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

    constructor(
        private readonly store: Store,
        private dataService: DataService,
        private readonly epgService: EpgService
    ) {}

    /**
     * Subscribe for values from the store on component init
     */
    ngOnInit(): void {
        this.timeshiftUntil$ = this.store.select(selectActive).pipe(
            map((active) => {
                this.channel = {
                    id: active?.tvg?.id,
                    name: active?.name,
                    url: [active?.url],
                    icon: [active?.tvg?.logo],
                };
                return (
                    active?.tvg?.rec ||
                    active?.timeshift ||
                    active?.catchup?.days
                );
            }),
            map((value) => moment().subtract(value, 'days').toISOString())
        );

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
        if (programs.length > 0) {
            this.setPlayingNow();
        } else {
            this.channel = null;
            this.store.dispatch(setCurrentEpgProgram(undefined));
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
                this.playingNow = playingNow;
                if (playingNow) {
                    this.store.dispatch(
                        setCurrentEpgProgram({ program: playingNow })
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

    /**
     * Removes all ipc renderer listeners after destroy
     */
    ngOnDestroy(): void {
        this.dataService.removeAllListeners(EPG_GET_PROGRAM_DONE);
    }
}
