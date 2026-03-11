import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel, EpgProgram } from 'shared-interfaces';
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
    imports: [ChannelListItemComponent, TranslatePipe],
})
export class RecentViewComponent {
    readonly recentItems = input.required<RecentViewItem[]>();
    readonly channelEpgMap = input.required<Map<string, EpgProgram | null>>();
    readonly progressTick = input.required<number>();
    readonly shouldShowEpg = input.required<boolean>();
    readonly activeChannelUrl = input<string | undefined>();

    readonly channelSelected = output<Channel>();
    readonly removeRecent = output<string>();

    readonly enrichedRecentItems = computed(() => {
        const recentItems = this.recentItems();
        const epgMap = this.channelEpgMap();
        this.progressTick();

        return recentItems.map(({ channel, viewedAt }) => {
            const channelId = channel?.tvg?.id?.trim() || channel?.name?.trim();
            const epgProgram = channelId ? epgMap.get(channelId) : null;

            return {
                channel,
                viewedAt,
                epgProgram,
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

    onRemoveRecent(channel: Channel, event: MouseEvent): void {
        event.stopPropagation();
        this.removeRecent.emit(channel.url);
    }
}
