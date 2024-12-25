import { OverlayRef } from '@angular/cdk/overlay';
import { CommonModule } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ElementRef,
    Inject,
    Input,
    OnDestroy,
    OnInit,
    ViewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { invoke } from '@tauri-apps/api/core';
import { addDays, differenceInMinutes, format, parse, subDays } from 'date-fns';
import { BehaviorSubject, Observable } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import { MomentDatePipe } from '../../../shared/pipes/moment-date.pipe';
import { EpgChannel } from '../../models/epg-channel.model';
import { EpgProgram } from '../../models/epg-program.model';
import { EpgItemDescriptionComponent } from '../epg-list/epg-item-description/epg-item-description.component';
import { COMPONENT_OVERLAY_REF } from '../video-player/video-player.component';

interface EnrichedProgram extends EpgProgram {
    startDate: Date;
    stopDate: Date;
    startPosition: number;
    width: number;
}

interface EnrichedChannel extends EpgChannel {
    programs: EnrichedProgram[];
}

@Component({
    standalone: true,
    imports: [
        CommonModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        MomentDatePipe,
        TranslateModule,
    ],
    selector: 'app-multi-epg-container',
    templateUrl: './multi-epg-container.component.html',
    styleUrls: ['./multi-epg-container.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiEpgContainerComponent
    implements OnInit, AfterViewInit, OnDestroy
{
    @ViewChild('epgContainer') epgContainer: ElementRef;

    @Input() set playlistChannels(value: Observable<Channel[]>) {
        if (value) {
            value.subscribe((channels) => {
                this._playlistChannels = channels;
                this.initializeVisibleChannels();
                this.requestPrograms();
            });
        }
    }
    private _playlistChannels: Channel[] = [];

    readonly timeHeader = Array.from({ length: 24 }, (_, i) => i);
    readonly hourWidth$ = new BehaviorSubject<number>(150);
    readonly barHeight = 50;

    channels$ = new BehaviorSubject<EnrichedChannel[]>([]);
    today = format(new Date(), 'yyyyMMdd');
    currentTimeLine = 0;
    visibleChannels = 20;
    channelsLowerRange = 0;
    channelsUpperRange = this.visibleChannels;
    originalEpgData: any[] = [];

    private dateCache = new Map<string, Date>();
    private interval: any;

    isLastPage = false;
    totalChannels = 0;

    constructor(
        private dialog: MatDialog,
        private cdr: ChangeDetectorRef,
        @Inject(COMPONENT_OVERLAY_REF) private overlayRef: OverlayRef
    ) {}

    ngOnInit() {
        this.calculateCurrentTimeBar();
        this.interval = setInterval(() => {
            this.calculateCurrentTimeBar();
        }, 60000);
    }

    ngAfterViewInit(): void {
        this.initializeVisibleChannels();
        this.scrollToCurrentTime();
    }

    private scrollToCurrentTime(): void {
        const timeNow = new Date();
        const scrollPosition =
            (timeNow.getHours() + timeNow.getMinutes() / 60) *
            this.hourWidth$.value;

        requestAnimationFrame(() => {
            const container = document.getElementById('epg-container');
            if (container) {
                container.scrollTo(
                    scrollPosition < 1000 ? 0 : scrollPosition - 150,
                    0
                );
            }
        });
    }

    private initializeVisibleChannels(): void {
        if (this.epgContainer) {
            const containerHeight =
                this.epgContainer.nativeElement.offsetHeight;
            const calculatedVisibleChannels = Math.floor(
                (containerHeight - this.barHeight) / this.barHeight
            );

            this.visibleChannels = Math.max(
                10,
                Math.min(calculatedVisibleChannels, 20)
            );
            this.channelsUpperRange = this.visibleChannels;

            console.log('Container height:', containerHeight);
            console.log('Calculated visible channels:', this.visibleChannels);
        }
    }

    ngOnDestroy(): void {
        this.hourWidth$.complete();
        this.channels$.complete();
        clearInterval(this.interval);
    }

    trackByIndex(index: number): number {
        return index;
    }

    trackByProgram(_: number, program: EnrichedProgram): string {
        return program.start + program.title;
    }

    async requestPrograms(): Promise<void> {
        const today = new Date();
        const startTime = format(subDays(today, 1), 'yyyyMMddHHmmss +0000');
        const endTime = format(addDays(today, 2), 'yyyyMMddHHmmss +0000');

        try {
            const channelNames = this._playlistChannels
                .map(
                    (channel) =>
                        channel.tvg?.id?.trim() ?? channel.name?.trim() ?? ''
                )
                .filter((name) => name !== '');

            console.log('Requesting EPG data:');
            console.log('- Skip:', this.channelsLowerRange);
            console.log('- Limit:', this.visibleChannels);
            console.log('- Channel names count:', channelNames.length);

            const response = await invoke<any>('get_epg_by_range', {
                startTime,
                endTime,
                skip: this.channelsLowerRange,
                limit: this.visibleChannels,
                playlistChannelNames: channelNames,
            });

            if (response) {
                console.log('Received channels:', response.length);
                this.originalEpgData = response;
                this.channels$.next(this.enrichProgramData());

                // Update isLastPage based on the number of channels received
                this.isLastPage = response.length < this.visibleChannels;

                this.cdr.detectChanges();
            }
        } catch (error) {
            console.error('Error fetching EPG data:', error);
        }
    }

    nextChannels(): void {
        this.channelsLowerRange += this.visibleChannels;
        this.channelsUpperRange =
            this.channelsLowerRange + this.visibleChannels;

        this.requestPrograms();
    }

    previousChannels(): void {
        this.channelsLowerRange = Math.max(
            0,
            this.channelsLowerRange - this.visibleChannels
        );
        this.channelsUpperRange =
            this.channelsLowerRange + this.visibleChannels;
        this.requestPrograms();
    }

    private getCachedDate(dateStr: string): Date {
        let date = this.dateCache.get(dateStr);
        if (!date) {
            date = new Date(dateStr);
            this.dateCache.set(dateStr, date);
        }
        return date;
    }

    private enrichProgramData(): EnrichedChannel[] {
        const hourWidth = this.hourWidth$.value;

        return this.originalEpgData.map((channel) => {
            const filteredPrograms = channel.programs
                .filter((item) => {
                    const itemDate = format(
                        this.getCachedDate(item.start),
                        'yyyyMMdd'
                    );
                    return itemDate === this.today;
                })
                .map((program) => {
                    const startDate = this.getCachedDate(program.start);
                    const stopDate = this.getCachedDate(program.stop);
                    const startPosition =
                        (startDate.getHours() + startDate.getMinutes() / 60) *
                        hourWidth;
                    const duration = differenceInMinutes(stopDate, startDate);
                    const width = (duration * hourWidth) / 60;

                    return {
                        ...program,
                        startDate,
                        stopDate,
                        startPosition,
                        width,
                    };
                });

            return {
                ...channel,
                programs: filteredPrograms,
            };
        });
    }

    zoomIn(): void {
        if (this.hourWidth$.value >= 800) return;
        this.hourWidth$.next(this.hourWidth$.value + 50);
        this.channels$.next(this.enrichProgramData());
        this.calculateCurrentTimeBar();
        this.cdr.detectChanges();
    }

    zoomOut(): void {
        if (this.hourWidth$.value <= 50) return;
        this.hourWidth$.next(this.hourWidth$.value - 50);
        this.channels$.next(this.enrichProgramData());
        this.calculateCurrentTimeBar();
        this.cdr.detectChanges();
    }

    calculateCurrentTimeBar(): void {
        this.currentTimeLine =
            (new Date().getHours() + new Date().getMinutes() / 60) *
            this.hourWidth$.value;
        this.cdr.detectChanges();
    }

    switchDay(direction: 'prev' | 'next'): void {
        const currentDate = parse(this.today, 'yyyyMMdd', new Date());
        this.today =
            direction === 'prev'
                ? format(subDays(currentDate, 1), 'yyyyMMdd')
                : format(addDays(currentDate, 1), 'yyyyMMdd');

        this.calculateCurrentTimeBar();
        this.channels$.next(this.enrichProgramData());
        this.cdr.detectChanges();
    }

    showDescription(program: EpgProgram): void {
        this.dialog.open(EpgItemDescriptionComponent, {
            data: program,
        });
    }

    close() {
        this.overlayRef.detach();
    }
}
