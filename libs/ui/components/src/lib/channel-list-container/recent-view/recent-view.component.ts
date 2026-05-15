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
import { resolveChannelEpgLookupKey } from '@iptvnator/m3u-state';
import { Channel, EpgProgram } from '@iptvnator/shared/interfaces';
import { ChannelDetailsDialogComponent } from '../channel-details-dialog/channel-details-dialog.component';
import { resolveChannelLogo } from '../channel-logo-fallback.util';
import { ChannelListItemComponent } from '../channel-list-item/channel-list-item.component';

export interface RecentViewItem {
    channel: Channel;
    viewedAt: string;
}

@Component({
    selector: 'app-recent-view',
    templateUrl: './recent-view.component.html',
    styleUrls: ['./recent-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListItemComponent,
        MatIconModule,
        MatMenuModule,
        TranslatePipe,
    ],
})
export class RecentViewComponent {
    private readonly dialog = inject(MatDialog);

    readonly contextMenuTrigger =
        viewChild.required<MatMenuTrigger>('contextMenuTrigger');

    readonly recentItems = input.required<RecentViewItem[]>();
    readonly searchTerm = input('');
    readonly channelEpgMap = input.required<Map<string, EpgProgram | null>>();
    readonly channelIconMap = input.required<Map<string, string>>();
    readonly progressTick = input.required<number>();
    readonly shouldShowEpg = input.required<boolean>();
    readonly openOnDoubleClick = input(false);
    readonly activeChannelUrl = input<string | undefined>();

    readonly channelSelected = output<Channel>();
    readonly channelPlaybackRequested = output<Channel>();
    readonly removeRecent = output<string>();

    readonly contextMenuChannel = signal<Channel | null>(null);
    readonly contextMenuPosition = signal({
        x: '0px',
        y: '0px',
    });

    readonly filteredRecentItems = computed(() => {
        const recentItems = this.recentItems();
        const term = this.searchTerm().trim().toLowerCase();

        if (!term) {
            return recentItems;
        }

        return recentItems.filter(({ channel }) =>
            `${channel.name ?? ''} ${channel.group?.title ?? ''}`
                .toLowerCase()
                .includes(term)
        );
    });

    readonly enrichedRecentItems = computed(() => {
        const recentItems = this.filteredRecentItems();
        const epgMap = this.channelEpgMap();
        const iconMap = this.channelIconMap();
        this.progressTick();

        return recentItems.map(({ channel, viewedAt }) => {
            const channelId = resolveChannelEpgLookupKey(channel);
            const epgProgram = channelId ? epgMap.get(channelId) : null;

            return {
                channel,
                viewedAt,
                epgProgram,
                logo: resolveChannelLogo(channel, iconMap),
                progressPercentage: this.calculateProgress(epgProgram),
            };
        });
    });

    private calculateProgress(
        epgProgram: EpgProgram | null | undefined
    ): number {
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

    trackByFn(_: number, item: RecentViewItem): string {
        return item.channel?.url;
    }

    onChannelClick(channel: Channel): void {
        this.channelSelected.emit(channel);
    }

    onChannelActivate(channel: Channel): void {
        if (this.openOnDoubleClick()) {
            this.channelPlaybackRequested.emit(channel);
        }
    }

    onRemoveRecent(channel: Channel, event: MouseEvent): void {
        event.stopPropagation();
        this.removeRecent.emit(channel.url);
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

    removeContextMenuChannel(): void {
        const channel = this.contextMenuChannel();
        if (!channel) {
            return;
        }

        this.contextMenuTrigger().closeMenu();
        this.removeRecent.emit(channel.url);
    }
}
