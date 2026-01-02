import { OverlayRef } from '@angular/cdk/overlay';
import { CommonModule } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    inject,
    Input,
    OnDestroy,
    OnInit,
    signal,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MomentDatePipe } from '@iptvnator/pipes';
import { TranslatePipe } from '@ngx-translate/core';
import { addDays, differenceInMinutes, format, parse, subDays } from 'date-fns';
import { Observable, Subscription } from 'rxjs';
import { Channel, EpgChannel, EpgProgram } from 'shared-interfaces';
import { EpgItemDescriptionComponent } from '../epg-list/epg-item-description/epg-item-description.component';
import { COMPONENT_OVERLAY_REF } from './overlay-ref.token';

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
    imports: [
        CommonModule,
        MatButtonModule,
        MatIcon,
        MatTooltip,
        MomentDatePipe,
        TranslatePipe,
    ],
    selector: 'app-multi-epg-container',
    templateUrl: './multi-epg-container.component.html',
    styleUrls: ['./multi-epg-container.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiEpgContainerComponent
    implements OnInit, AfterViewInit, OnDestroy
{
    readonly epgContainer = viewChild.required<ElementRef>('epgContainer');

    @Input() set playlistChannels(value: Observable<Channel[]>) {
        if (this.playlistChannelsSubscription) {
            this.playlistChannelsSubscription.unsubscribe();
        }

        if (value) {
            this.playlistChannelsSubscription = value.subscribe(() => {
                this.channelsLowerRange = 0;
                this.originalEpgData.set([]);
                this.isLastPage.set(false);
                this.initializeVisibleChannels();
                this.requestPrograms();
            });
        }
    }

    @Input() activeChannelId: string | null = null;

    // Signals
    readonly hourWidth = signal(150);
    readonly today = signal(format(new Date(), 'yyyyMMdd'));
    readonly originalEpgData = signal<any[]>([]);
    readonly isLoading = signal(false);
    readonly isLastPage = signal(false);
    readonly channelFilter = signal('');
    readonly isSearchExpanded = signal(false);

    // Program search signals
    readonly isProgramSearchOpen = signal(false);
    readonly programSearchQuery = signal('');
    readonly programSearchResults = signal<any[]>([]);
    readonly isSearchingPrograms = signal(false);
    readonly highlightedProgramKey = signal<string | null>(null);
    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Computed signal for enriched channels - automatically updates when dependencies change
    readonly channels = computed(() => this.enrichProgramData());

    // Computed signal for filtered channels based on search term
    readonly filteredChannels = computed(() => {
        const filter = this.channelFilter().toLowerCase().trim();
        const allChannels = this.channels();

        if (!filter) {
            return allChannels;
        }

        return allChannels.filter(channel => {
            const name = this.getChannelName(channel).toLowerCase();
            return name.includes(filter);
        });
    });

    // Computed signal for current time line position
    readonly currentTimeLine = computed(() => {
        const now = new Date();
        return (now.getHours() + now.getMinutes() / 60) * this.hourWidth();
    });

    // Constants
    readonly timeHeader = Array.from({ length: 24 }, (_, i) => i);
    readonly barHeight = 50;

    // Pagination state
    visibleChannels = 20;
    channelsLowerRange = 0;
    channelsUpperRange = this.visibleChannels;
    totalChannels = 0;

    private dateCache = new Map<string, Date>();
    private interval!: ReturnType<typeof setInterval>;
    private playlistChannelsSubscription?: Subscription;

    private readonly dialog = inject(MatDialog);
    private readonly overlayRef = inject<OverlayRef>(COMPONENT_OVERLAY_REF);

    ngOnInit() {
        // Update current time line every minute
        this.interval = setInterval(() => {
            // Force recomputation by updating hourWidth to same value
            // This triggers the computed signal to recalculate
            this.hourWidth.update(v => v);
        }, 60000);
    }

    ngAfterViewInit(): void {
        this.initializeVisibleChannels();
        this.scrollToCurrentTime();
    }

    private scrollToCurrentTime(): void {
        const timeNow = new Date();
        const scrollPosition =
            (timeNow.getHours() + timeNow.getMinutes() / 60) * this.hourWidth();

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
        const epgContainer = this.epgContainer();
        if (epgContainer) {
            const containerHeight = epgContainer.nativeElement.offsetHeight;
            const calculatedVisibleChannels = Math.floor(
                (containerHeight - this.barHeight) / this.barHeight
            );

            this.visibleChannels = Math.max(
                10,
                Math.min(calculatedVisibleChannels, 20)
            );
            this.channelsUpperRange = this.visibleChannels;
        }
    }

    ngOnDestroy(): void {
        clearInterval(this.interval);

        if (this.playlistChannelsSubscription) {
            this.playlistChannelsSubscription.unsubscribe();
        }

        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
    }

    trackByIndex(index: number): number {
        return index;
    }

    trackByProgram(_: number, program: EnrichedProgram): string {
        return `${program.start}|${program?.title?.toString() ?? ''}`;
    }

    async requestPrograms(): Promise<void> {
        if (!window.electron) {
            console.warn('Multi-EPG not available: Electron not detected');
            return;
        }

        if (this.isLoading() || this.isLastPage()) {
            return;
        }

        this.isLoading.set(true);

        try {
            const response = await window.electron.getEpgChannelsByRange(
                this.channelsLowerRange,
                this.visibleChannels
            );

            if (response && Array.isArray(response)) {
                // Append new data to existing data
                this.originalEpgData.update(data => [...data, ...response]);

                // Update isLastPage based on the number of channels received
                this.isLastPage.set(response.length < this.visibleChannels);

                // Update range for next fetch
                this.channelsLowerRange += response.length;
            }
        } catch (error) {
            console.error('Error fetching EPG data:', error);
        } finally {
            this.isLoading.set(false);
        }
    }

    onScroll(event: Event): void {
        const target = event.target as HTMLElement;
        const scrollTop = target.scrollTop;
        const scrollHeight = target.scrollHeight;
        const clientHeight = target.clientHeight;

        // Load more when user scrolls to within 200px of the bottom
        if (scrollHeight - scrollTop - clientHeight < 200) {
            this.requestPrograms();
        }
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
        const hourWidthValue = this.hourWidth();
        const todayValue = this.today();
        const data = this.originalEpgData();

        return data.map((channel) => {
            const filteredPrograms = (channel.programs || [])
                .filter((item: EpgProgram) => {
                    const itemDate = format(
                        this.getCachedDate(item.start),
                        'yyyyMMdd'
                    );
                    return itemDate === todayValue;
                })
                .map((program: EpgProgram) => {
                    const startDate = this.getCachedDate(program.start);
                    const stopDate = this.getCachedDate(program.stop);
                    const startPosition =
                        (startDate.getHours() + startDate.getMinutes() / 60) *
                        hourWidthValue;
                    const duration = differenceInMinutes(stopDate, startDate);
                    const width = (duration * hourWidthValue) / 60;

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

    /**
     * Get display name from EpgChannel
     */
    getChannelName(channel: EpgChannel): string {
        if (typeof channel.displayName === 'string') {
            return channel.displayName;
        }
        if (Array.isArray(channel.displayName) && channel.displayName.length > 0) {
            return channel.displayName[0].value;
        }
        return '';
    }

    /**
     * Get icon from EpgChannel
     */
    getChannelIcon(channel: EpgChannel): string {
        if ((channel as any).iconUrl) {
            return (channel as any).iconUrl;
        }
        if (channel.icon && channel.icon.length > 0) {
            return channel.icon[0].src;
        }
        return '';
    }

    zoomIn(): void {
        if (this.hourWidth() >= 800) return;
        this.hourWidth.update(v => v + 50);
    }

    zoomOut(): void {
        if (this.hourWidth() <= 50) return;
        this.hourWidth.update(v => v - 50);
    }

    toggleSearch(): void {
        this.isSearchExpanded.update(v => !v);
        if (!this.isSearchExpanded()) {
            this.channelFilter.set('');
        }
    }

    clearFilter(): void {
        this.channelFilter.set('');
    }

    onFilterInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.channelFilter.set(input.value);
    }

    switchDay(direction: 'prev' | 'next'): void {
        const currentDate = parse(this.today(), 'yyyyMMdd', new Date());
        this.today.set(
            direction === 'prev'
                ? format(subDays(currentDate, 1), 'yyyyMMdd')
                : format(addDays(currentDate, 1), 'yyyyMMdd')
        );
    }

    showDescription(program: EpgProgram): void {
        this.dialog.open(EpgItemDescriptionComponent, {
            data: program,
        });
    }

    // Program search methods
    toggleProgramSearch(): void {
        this.isProgramSearchOpen.update(v => !v);
        if (!this.isProgramSearchOpen()) {
            this.programSearchQuery.set('');
            this.programSearchResults.set([]);
        }
    }

    onProgramSearchInput(event: Event): void {
        const input = event.target as HTMLInputElement;
        const query = input.value.trim();
        this.programSearchQuery.set(query);

        // Clear previous debounce timer
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }

        if (query.length < 2) {
            this.programSearchResults.set([]);
            this.isSearchingPrograms.set(false);
            return;
        }

        // Debounce search by 500ms - show spinner only when search actually starts
        this.searchDebounceTimer = setTimeout(async () => {
            this.isSearchingPrograms.set(true);
            try {
                const results = await window.electron.searchEpgPrograms(query, 20);
                this.programSearchResults.set(results || []);
            } catch (error) {
                console.error('Error searching programs:', error);
                this.programSearchResults.set([]);
            } finally {
                this.isSearchingPrograms.set(false);
            }
        }, 500);
    }

    clearProgramSearch(): void {
        this.programSearchQuery.set('');
        this.programSearchResults.set([]);
    }

    showProgramDetails(program: any): void {
        // Get channel id (DB returns channel_id, EPG uses channel)
        const channelId = program.channel_id || program.channel;

        // Find channel name
        const channel = this.channels().find(ch => ch.id === channelId);
        const channelName = channel ? this.getChannelName(channel) : null;

        // Open the program details dialog with channel name
        this.dialog.open(EpgItemDescriptionComponent, {
            data: { ...program, channelName },
        });
    }

    getProgramKey(program: any): string {
        const channelId = program.channel_id || program.channel;
        return `${channelId}|${program.start}`;
    }

    formatProgramTime(program: EpgProgram): string {
        const start = new Date(program.start);
        const stop = new Date(program.stop);
        return `${format(start, 'HH:mm')} - ${format(stop, 'HH:mm')}`;
    }

    formatProgramDate(program: EpgProgram): string {
        const start = new Date(program.start);
        return format(start, 'MMM d');
    }

    close() {
        this.overlayRef.detach();
    }
}
