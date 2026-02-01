import { KeyValue, KeyValuePipe, TitleCasePipe } from '@angular/common';
import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    inject,
    input,
    NgZone,
    OnDestroy,
    output,
    signal,
} from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel, EpgProgram } from 'shared-interfaces';
import { ChannelListItemComponent } from '../channel-list-item/channel-list-item.component';
import { EnrichedChannel } from '../all-channels-tab/all-channels-tab.component';

@Component({
    selector: 'app-groups-tab',
    templateUrl: './groups-tab.component.html',
    styleUrls: ['./groups-tab.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListItemComponent,
        KeyValuePipe,
        MatExpansionModule,
        MatIconModule,
        TitleCasePipe,
        TranslatePipe,
    ],
})
export class GroupsTabComponent implements AfterViewInit, OnDestroy {
    private readonly cdr = inject(ChangeDetectorRef);
    private readonly ngZone = inject(NgZone);

    /** Grouped channels object */
    readonly groupedChannels = input.required<{ [key: string]: Channel[] }>();

    /** EPG map for channel enrichment */
    readonly channelEpgMap = input.required<Map<string, EpgProgram | null>>();

    /** Progress tick to trigger progress recalculation */
    readonly progressTick = input.required<number>();

    /** Whether to show EPG data */
    readonly shouldShowEpg = input.required<boolean>();

    /** Currently active channel URL */
    readonly activeChannelUrl = input<string | undefined>();

    /** Emits when a channel is selected */
    readonly channelSelected = output<Channel>();

    /** IntersectionObserver for infinite scroll in groups */
    private groupScrollObserver?: IntersectionObserver;

    /** Track observed sentinel elements */
    private observedSentinels = new Set<Element>();

    /** Track expanded groups with their load limits for lazy-loading */
    readonly expandedGroupLimits = signal(new Map<string, number>());

    /** Default number of channels to show when group is expanded */
    private readonly DEFAULT_GROUP_LIMIT = 50;

    ngAfterViewInit(): void {
        // Set up IntersectionObserver for infinite scroll in groups
        this.groupScrollObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const element = entry.target as HTMLElement;
                        const groupKey = element.dataset['groupKey'];
                        const totalInGroup = parseInt(element.dataset['totalInGroup'] || '0', 10);

                        if (groupKey) {
                            // Run inside NgZone to trigger change detection
                            this.ngZone.run(() => {
                                this.loadMoreInGroup(groupKey, totalInGroup);
                            });
                        }
                    }
                });
            },
            {
                root: null, // Use viewport
                rootMargin: '100px', // Load more before reaching the bottom
                threshold: 0.1,
            }
        );
    }

    ngOnDestroy(): void {
        // Clean up IntersectionObserver
        if (this.groupScrollObserver) {
            this.groupScrollObserver.disconnect();
            this.observedSentinels.clear();
        }
    }

    /**
     * Gets the current limit for a group, or returns default
     */
    getGroupLimit(groupKey: string): number {
        return this.expandedGroupLimits().get(groupKey) ?? this.DEFAULT_GROUP_LIMIT;
    }

    /**
     * Loads more channels in a group (used by infinite scroll)
     */
    loadMoreInGroup(groupKey: string, totalInGroup: number): void {
        const limits = new Map(this.expandedGroupLimits());
        const current = limits.get(groupKey) ?? this.DEFAULT_GROUP_LIMIT;
        // Only load more if there are more items to show
        if (current < totalInGroup) {
            limits.set(groupKey, current + this.DEFAULT_GROUP_LIMIT);
            this.expandedGroupLimits.set(limits);
            this.cdr.markForCheck();
        }
    }

    /**
     * Sets up IntersectionObserver for a group's sentinel element.
     */
    private observeGroupSentinel(element: HTMLElement, groupKey: string, totalInGroup: number): void {
        if (!element || this.observedSentinels.has(element)) {
            return;
        }

        // Store group info on the element for the observer callback
        element.dataset['groupKey'] = groupKey;
        element.dataset['totalInGroup'] = String(totalInGroup);

        this.groupScrollObserver?.observe(element);
        this.observedSentinels.add(element);
    }

    /**
     * Called when an expansion panel opens - sets up infinite scroll observer
     */
    onGroupPanelOpened(groupKey: string, totalInGroup: number): void {
        // Use setTimeout to ensure the panel content is rendered
        setTimeout(() => {
            const sentinel = document.querySelector(`[data-sentinel-group="${groupKey}"]`);
            if (sentinel) {
                this.observeGroupSentinel(sentinel as HTMLElement, groupKey, totalInGroup);
            }
        }, 50);
    }

    /**
     * Gets enriched channels for a specific group
     */
    getEnrichedGroupChannels(channels: Channel[]): EnrichedChannel[] {
        const epgMap = this.channelEpgMap();
        // Read progressTick to create dependency for progress refresh
        this.progressTick();

        return channels.map(channel => {
            const channelId = channel?.tvg?.id?.trim() || channel?.name?.trim();
            const epgProgram = channelId ? epgMap.get(channelId) : null;
            return {
                ...channel,
                epgProgram,
                progressPercentage: this.calculateProgress(epgProgram),
            } as EnrichedChannel;
        });
    }

    /**
     * Calculates progress percentage for an EPG program
     */
    private calculateProgress(epgProgram: EpgProgram | null | undefined): number {
        if (!epgProgram) {
            return 0;
        }

        const now = new Date().getTime();
        const start = new Date(epgProgram.start).getTime();
        const stop = new Date(epgProgram.stop).getTime();

        const total = stop - start;
        const elapsed = now - start;

        return Math.min(100, Math.max(0, (elapsed / total) * 100));
    }

    trackByFn(_: number, channel: Channel): string {
        return channel?.id;
    }

    onChannelClick(channel: Channel): void {
        this.channelSelected.emit(channel);
    }

    /**
     * Comparator for sorting groups - numeric groups first, then alphabetical
     */
    groupsComparator = (
        a: KeyValue<string, Channel[]>,
        b: KeyValue<string, Channel[]>
    ): number => {
        const numA = parseInt(a.key.replace(/\D/g, ''));
        const numB = parseInt(b.key.replace(/\D/g, ''));

        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }

        return a.key.localeCompare(b.key);
    };
}
