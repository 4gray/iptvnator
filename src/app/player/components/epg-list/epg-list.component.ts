import { Component, NgZone } from '@angular/core';
import * as moment from 'moment';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { EPG_GET_PROGRAM_DONE } from '../../../../../shared/ipc-commands';
import { DataService } from '../../../services/data.service';
import { ChannelQuery, ChannelStore } from '../../../state';
import { EpgChannel } from '../../models/epg-channel.model';
import { EpgProgram } from '../../models/epg-program.model';

export interface EpgData {
    channel: EpgChannel;
    items: EpgProgram[];
}

const DATE_FORMAT = 'YYYYMMDD';
const DATE_TIME_FORMAT = 'YYYYMMDDHHmm ZZ';

@Component({
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
    items: EpgProgram[] = [];

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

    /**
     * Creates an instance of EpgListComponent
     * @param channelQuery
     * @param channelStore
     * @param electronService
     * @param ngZone
     */
    constructor(
        private channelQuery: ChannelQuery,
        private channelStore: ChannelStore,
        private electronService: DataService,
        private ngZone: NgZone
    ) {
        this.electronService.listenOn(
            EPG_GET_PROGRAM_DONE,
            (event, response) => {
                this.ngZone.run(() => this.handleEpgData(response));
            }
        );
    }

    /**
     * Subscribe for values from the store on component init
     */
    ngOnInit(): void {
        this.timeshiftUntil$ = this.channelQuery
            .select(
                (store) =>
                    store.active?.tvg?.rec ||
                    store.active?.timeshift ||
                    store.active?.catchup?.days
            )
            .pipe(
                map((value) =>
                    moment(Date.now())
                        .subtract(value, 'days')
                        .format(DATE_TIME_FORMAT)
                )
            );
    }

    /**
     * Handles incoming epg programs for the active channel from the main process
     * @param programs
     */
    handleEpgData(programs: { payload: EpgData }): void {
        if (programs?.payload?.items?.length > 0) {
            this.programs = programs;
            this.timeNow = moment(Date.now()).format(DATE_TIME_FORMAT);
            this.dateToday = moment(Date.now()).format(DATE_FORMAT);
            this.channel = programs.payload?.channel;
            this.items = this.selectPrograms(programs);

            this.setPlayingNow();
        } else {
            this.items = [];
            this.channel = null;
            this.channelStore.setCurrentEpgProgram(undefined);
        }
    }

    /**
     * Selects the program based on the active date
     * @param programs object with all available epg programs for the active channel
     */
    selectPrograms(programs: { payload: EpgData }): EpgProgram[] {
        return programs.payload?.items
            .filter((item) => item.start.includes(this.dateToday.toString()))
            .map((program) => ({
                ...program,
                start: moment(program.start, DATE_TIME_FORMAT).format(
                    DATE_TIME_FORMAT
                ),
                stop: moment(program.stop, DATE_TIME_FORMAT).format(
                    DATE_TIME_FORMAT
                ),
            }))
            .sort((a, b) => {
                return a.start.localeCompare(b.start);
            });
    }

    /**
     * Changes the date to update the epg list with programs
     * @param direction direction to switch
     */
    changeDate(direction: 'next' | 'prev'): void {
        let dateToSwitch;
        if (direction === 'next') {
            dateToSwitch = moment(this.dateToday, DATE_FORMAT)
                .add(1, 'days')
                .format(DATE_FORMAT);
        } else if (direction === 'prev') {
            dateToSwitch = moment(this.dateToday, DATE_FORMAT)
                .subtract(1, 'days')
                .format(DATE_FORMAT);
        }
        this.dateToday = dateToSwitch;
        this.items = this.selectPrograms(this.programs);
    }

    /**
     * Sets the playing now variable based on the current time
     */
    setPlayingNow(): void {
        this.playingNow = this.items.find(
            (item) => this.timeNow >= item.start && this.timeNow <= item.stop
        );
        this.channelStore.setCurrentEpgProgram(this.playingNow);
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
            this.channelStore.resetActiveEpgProgram();
        } else {
            if (!timeshift) return;
            this.channelStore.setActiveEpgProgram(program);
        }
        this.playingNow = program;
    }

    /**
     * Removes all ipc renderer listeners after destroy
     */
    ngOnDestroy(): void {
        this.electronService.removeAllListeners(EPG_GET_PROGRAM_DONE);
    }
}
