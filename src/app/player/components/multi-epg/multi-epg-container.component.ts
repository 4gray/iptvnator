import { OverlayRef } from '@angular/cdk/overlay';
import {
    AfterViewInit,
    Component,
    ElementRef,
    Inject,
    NgZone,
    OnInit,
    ViewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { addDays, differenceInMinutes, format, parse, subDays } from 'date-fns';
import {
    EPG_GET_CHANNELS_BY_RANGE,
    EPG_GET_CHANNELS_BY_RANGE_RESPONSE,
} from '../../../../../shared/ipc-commands';
import { DataService } from '../../../services/data.service';
import { EpgChannel } from '../../models/epg-channel.model';
import { EpgProgram } from '../../models/epg-program.model';
import { EpgItemDescriptionComponent } from '../epg-list/epg-item-description/epg-item-description.component';
import { COMPONENT_OVERLAY_REF } from '../video-player/video-player.component';

@Component({
    selector: 'app-multi-epg-container',
    templateUrl: './multi-epg-container.component.html',
    styleUrls: ['./multi-epg-container.component.scss'],
})
export class MultiEpgContainerComponent implements OnInit, AfterViewInit {
    @ViewChild('epgContainer') epgContainer: ElementRef;
    timeHeader = new Array(24);
    hourWidth = 150;
    barHeight = 50;
    originalEpgData: (EpgChannel & { programs: EpgProgram[] })[] = [];
    channels: (EpgChannel & { programs: EpgProgram[] })[] = [];
    today = format(new Date(), 'yyyyMMdd');
    currentTimeLine = 0;
    visibleChannels;
    channelsLowerRange = 0;
    channelsUpperRange;

    constructor(
        private dataService: DataService,
        private dialog: MatDialog,
        private ngZone: NgZone,
        @Inject(COMPONENT_OVERLAY_REF) private overlayRef: OverlayRef
    ) {
        this.dataService.listenOn(
            EPG_GET_CHANNELS_BY_RANGE_RESPONSE,
            (event, response) =>
                this.ngZone.run(() => {
                    if (response) {
                        this.originalEpgData = response.payload;
                        this.channels = this.enrichProgramData();
                    }
                })
        );
    }

    ngOnInit(): void {
        this.calculateCurrentTimeBar();
    }

    ngAfterViewInit(): void {
        const timeNow = new Date();
        const scrollPosition =
            (timeNow.getHours() + timeNow.getMinutes() / 60) * this.hourWidth;
        document
            .getElementById('epg-container')!
            .scrollTo(scrollPosition < 1000 ? 0 : scrollPosition - 150, 0);

        const borderInPx =
            this.epgContainer.nativeElement.offsetHeight / this.barHeight;
        this.visibleChannels = Math.floor(
            (this.epgContainer.nativeElement.offsetHeight - borderInPx) /
                this.barHeight -
                1
        );
        this.channelsUpperRange = this.visibleChannels;
        this.requestPrograms();
    }

    nextChannels(): void {
        this.channelsLowerRange = this.channelsUpperRange;
        this.channelsUpperRange =
            this.channelsUpperRange + this.visibleChannels;
        this.channels = [];
        this.requestPrograms();
    }

    previousChannels(): void {
        this.channelsUpperRange =
            this.channelsUpperRange - this.visibleChannels;
        this.channelsLowerRange =
            this.channelsUpperRange - this.visibleChannels;

        this.requestPrograms();
    }

    requestPrograms() {
        this.dataService.sendIpcEvent(EPG_GET_CHANNELS_BY_RANGE, {
            limit: this.channelsUpperRange,
            skip: this.channelsLowerRange,
        });
    }

    enrichProgramData() {
        return this.originalEpgData.map((channel) => {
            return {
                ...channel,
                programs: channel.programs
                    .filter((item) => item.start.includes(this.today))
                    .map((program) => {
                        const startDate = parse(
                            program.start,
                            'yyyyMMddHHmmss XXXX',
                            addDays(new Date(), 1)
                        );
                        const stopDate = parse(
                            program.stop,
                            'yyyyMMddHHmmss XXXX',
                            addDays(new Date(), 1)
                        );
                        return {
                            ...program,
                            startDate,
                            stopDate,
                            startPosition: this.positionToStartInPx(startDate),
                            width: this.programDurationInPx(
                                startDate,
                                stopDate
                            ),
                        };
                    }),
            };
        });
    }

    positionToStartInPx(startDate: Date) {
        return (
            (startDate.getHours() + startDate.getMinutes() / 60) *
            this.hourWidth
        );
    }

    programDurationInPx(startDate: Date, stopDate: Date) {
        const duration = differenceInMinutes(stopDate, startDate);
        return (duration * this.hourWidth) / 60;
    }

    recalculate(): void {
        this.channels.forEach((channel) => {
            channel.programs = channel.programs.map((program: any) => {
                return {
                    ...program,
                    startPosition: this.positionToStartInPx(program.startDate),
                    width: this.programDurationInPx(
                        program.startDate,
                        program.stopDate
                    ),
                };
            });
        });
    }

    zoomIn(): void {
        this.hourWidth += 50;
        this.recalculate();
        this.calculateCurrentTimeBar();
    }

    zoomOut(): void {
        if (this.hourWidth <= 50) return;
        this.hourWidth -= 50;
        this.recalculate();
        this.calculateCurrentTimeBar();
    }

    calculateCurrentTimeBar(): void {
        const timeNow = new Date();
        this.currentTimeLine =
            (timeNow.getHours() + timeNow.getMinutes() / 60) * this.hourWidth;
    }

    switchDay(direction: 'prev' | 'next'): void {
        this.today =
            direction === 'prev'
                ? format(
                      subDays(parse(this.today, 'yyyyMMdd', new Date()), 1),
                      'yyyyMMdd'
                  )
                : format(
                      addDays(parse(this.today, 'yyyyMMdd', new Date()), 1),
                      'yyyyMMdd'
                  );
        this.calculateCurrentTimeBar();
        this.channels = this.enrichProgramData();
    }

    /**
     * Opens the dialog with details about the selected program
     * @param program selected epg program
     */
    showDescription(program: EpgProgram): void {
        this.dialog.open(EpgItemDescriptionComponent, {
            data: program,
        });
    }

    close() {
        this.overlayRef.detach();
    }
}
