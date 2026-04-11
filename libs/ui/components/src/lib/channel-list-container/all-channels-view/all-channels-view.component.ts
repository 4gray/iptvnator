import { ScrollingModule } from '@angular/cdk/scrolling';

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel, EpgProgram } from 'shared-interfaces';
import { ChannelDetailsDialogComponent } from '../channel-details-dialog/channel-details-dialog.component';
import { ChannelListItemComponent } from '../channel-list-item/channel-list-item.component';

/** Enriched channel with pre-computed EPG and progress data */
export interface EnrichedChannel extends Channel {
    epgProgram: EpgProgram | null | undefined;
    progressPercentage: number;
}

@Component({
    selector: 'app-all-channels-view',
    templateUrl: './all-channels-view.component.html',
    styleUrls: ['./all-channels-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListItemComponent,
        MatIconModule,
        MatMenuModule,
        ScrollingModule,
        TranslatePipe,
    ],
})
export class AllChannelsViewComponent {
    private readonly dialog = inject(MatDialog);

    readonly contextMenuTrigger = viewChild.required<MatMenuTrigger>(
        'contextMenuTrigger'
    );

    /** All channels (will be filtered by search) */
    readonly channels = input.required<Channel[]>();
    readonly searchTerm = input('');

    /** EPG map for channel enrichment */
    readonly channelEpgMap = input.required<Map<string, EpgProgram | null>>();

    /** Progress tick to trigger progress recalculation */
    readonly progressTick = input.required<number>();

    /** Whether to show EPG data */
    readonly shouldShowEpg = input.required<boolean>();

    /** Item size for virtual scroll */
    readonly itemSize = input.required<number>();

    /** Currently active channel URL */
    readonly activeChannelUrl = input<string | undefined>();

    /** Set of favorite channel URLs */
    readonly favoriteIds = input<Set<string>>(new Set());

    /** Emits when a channel is selected */
    readonly channelSelected = output<Channel>();

    /** Emits when favorite is toggled */
    readonly favoriteToggled = output<{
        channel: Channel;
        event: MouseEvent;
    }>();

    readonly contextMenuChannel = signal<Channel | null>(null);
    readonly contextMenuPosition = signal({
        x: '0px',
        y: '0px',
    });

    /**
     * Computed signal for filtered and enriched channels.
     */
    readonly enrichedChannels = computed(() => {
        const term = this.searchTerm().trim().toLowerCase();
        const channels = this.channels();
        const epgMap = this.channelEpgMap();
        // Read progressTick to create dependency for progress refresh
        this.progressTick();

        let result = channels;

        // Filter if search term exists
        if (term) {
            result = channels.filter((ch) =>
                ch.name?.toLowerCase().includes(term)
            );
        }

        // Enrich with EPG data and pre-calculate progress
        return result.map((channel) => {
            const channelId = channel?.tvg?.id?.trim() || channel?.name?.trim();
            const epgProgram = channelId ? epgMap.get(channelId) : null;
            return {
                ...channel,
                epgProgram,
                progressPercentage: this.calculateProgress(epgProgram),
            } as EnrichedChannel;
        });
    });

    /**
     * Calculates progress percentage for an EPG program
     */
    private calculateProgress(
        epgProgram: EpgProgram | null | undefined
    ): number {
        if (!epgProgram) {
            return 0;
        }

        const now = Date.now();
        const start = new Date(epgProgram.start).getTime();
        const stop = new Date(epgProgram.stop).getTime();

        // Validate start/stop are finite numbers
        if (!Number.isFinite(start) || !Number.isFinite(stop)) {
            return 0;
        }

        const total = stop - start;

        // Bail out if duration is zero or negative
        if (total <= 0) {
            return 0;
        }

        // Clamp elapsed to [0, total]
        const elapsed = Math.min(total, Math.max(0, now - start));

        return Math.round((elapsed / total) * 100);
    }

    trackByFn(_: number, channel: Channel): string {
        return channel?.id;
    }

    onChannelClick(channel: Channel): void {
        this.channelSelected.emit(channel);
    }

    onFavoriteToggle(channel: Channel, event: MouseEvent): void {
        this.favoriteToggled.emit({ channel, event });
    }

    onChannelContextMenu(channel: Channel, event: MouseEvent): void {
        this.contextMenuChannel.set(channel);
        this.contextMenuPosition.set({
            x: `${event.clientX}px`,
            y: `${event.clientY}px`,
        });

        const trigger = this.contextMenuTrigger();
        if (trigger.menuOpen) {
            trigger.closeMenu();
        }

        queueMicrotask(() => {
            this.contextMenuTrigger().openMenu();
        });
    }

    openChannelDetails(): void {
        const channel = this.contextMenuChannel();
        if (!channel) {
            return;
        }

        this.contextMenuTrigger().closeMenu();
        this.dialog.open(ChannelDetailsDialogComponent, {
            data: channel,
            maxWidth: '720px',
            width: 'calc(100vw - 32px)',
        });
    }
}
