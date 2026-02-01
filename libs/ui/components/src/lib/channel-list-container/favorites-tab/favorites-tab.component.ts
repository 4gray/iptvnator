import {
    CdkDragDrop,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel, EpgProgram } from 'shared-interfaces';
import { ChannelListItemComponent } from '../channel-list-item/channel-list-item.component';
import { EnrichedChannel } from '../all-channels-tab/all-channels-tab.component';

@Component({
    selector: 'app-favorites-tab',
    templateUrl: './favorites-tab.component.html',
    styleUrls: ['./favorites-tab.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListItemComponent,
        DragDropModule,
        TranslatePipe,
    ],
})
export class FavoritesTabComponent {
    /** Favorite channels */
    readonly favorites = input.required<Channel[]>();

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

    /** Emits when favorite is toggled (removed) */
    readonly favoriteToggled = output<{ channel: Channel; event: MouseEvent }>();

    /** Emits when favorites order changes via drag-drop */
    readonly favoritesReordered = output<string[]>();

    /**
     * Gets enriched favorites with EPG data
     */
    get enrichedFavorites(): EnrichedChannel[] {
        const favorites = this.favorites();
        const epgMap = this.channelEpgMap();
        // Read progressTick to trigger recalculation
        this.progressTick();

        return favorites.map(channel => {
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

    onFavoriteToggle(channel: Channel, event: MouseEvent): void {
        this.favoriteToggled.emit({ channel, event });
    }

    onDrop(event: CdkDragDrop<Channel[]>): void {
        const favorites = [...this.favorites()];
        moveItemInArray(favorites, event.previousIndex, event.currentIndex);
        this.favoritesReordered.emit(favorites.map(item => item.url));
    }
}
