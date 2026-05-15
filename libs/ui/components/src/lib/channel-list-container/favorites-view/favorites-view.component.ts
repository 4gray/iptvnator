import {
    CdkDragDrop,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
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
import { ChannelEpgMetadata } from '../all-channels-view/all-channels-view.component';
import { ChannelDetailsDialogComponent } from '../channel-details-dialog/channel-details-dialog.component';
import { resolveChannelLogo } from '../channel-logo-fallback.util';
import { ChannelListItemComponent } from '../channel-list-item/channel-list-item.component';

@Component({
    selector: 'app-favorites-view',
    templateUrl: './favorites-view.component.html',
    styleUrls: ['./favorites-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListItemComponent,
        DragDropModule,
        MatIconModule,
        MatMenuModule,
        TranslatePipe,
    ],
})
export class FavoritesViewComponent {
    private readonly dialog = inject(MatDialog);

    readonly contextMenuTrigger =
        viewChild.required<MatMenuTrigger>('contextMenuTrigger');

    /** Favorite channels */
    readonly favorites = input.required<Channel[]>();
    readonly searchTerm = input('');

    /** EPG map for channel enrichment */
    readonly channelEpgMap = input.required<Map<string, EpgProgram | null>>();
    readonly channelIconMap = input.required<Map<string, string>>();

    /** Progress tick to trigger progress recalculation */
    readonly progressTick = input.required<number>();

    /** Whether to show EPG data */
    readonly shouldShowEpg = input.required<boolean>();
    readonly openOnDoubleClick = input(false);

    /** Currently active channel URL */
    readonly activeChannelUrl = input<string | undefined>();

    /** Emits when a channel is selected */
    readonly channelSelected = output<Channel>();
    readonly channelPlaybackRequested = output<Channel>();

    /** Emits when favorite is toggled (removed) */
    readonly favoriteToggled = output<{
        channel: Channel;
        event: MouseEvent;
    }>();

    /** Emits when favorites order changes via drag-drop */
    readonly favoritesReordered = output<string[]>();

    readonly contextMenuChannel = signal<Channel | null>(null);
    readonly contextMenuPosition = signal({
        x: '0px',
        y: '0px',
    });

    readonly hasSearchTerm = computed(() => this.searchTerm().trim().length > 0);
    readonly filteredFavorites = computed(() => {
        const favorites = this.favorites();
        const term = this.searchTerm().trim().toLowerCase();

        if (!term) {
            return favorites;
        }

        return favorites.filter((channel) =>
            `${channel.name ?? ''} ${channel.group?.title ?? ''}`
                .toLowerCase()
                .includes(term)
        );
    });

    /**
     * Side-car EPG metadata keyed by channel EPG lookup key. Rebuilt every
     * progressTick (~30 s) but only contains entries for channels with EPG
     * data. Replaces the previous spread-clone-every-channel pattern.
     */
    readonly epgMetadataMap = computed(() => {
        const epgMap = this.channelEpgMap();
        this.progressTick();

        const result = new Map<string, ChannelEpgMetadata>();
        epgMap.forEach((program, channelId) => {
            result.set(channelId, {
                epgProgram: program,
                progressPercentage: this.calculateProgress(program),
            });
        });
        return result;
    });

    /** Resolves the EPG lookup key the side-car map is keyed by. */
    getChannelEpgKey(channel: Channel): string {
        return resolveChannelEpgLookupKey(channel) ?? '';
    }

    /** Resolves the channel logo. Called per visible row from the template. */
    getLogoForChannel(channel: Channel): string {
        return resolveChannelLogo(channel, this.channelIconMap());
    }

    /**
     * Calculates progress percentage for an EPG program
     */
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

    trackByFn(_: number, channel: Channel): string {
        return channel?.id;
    }

    onChannelClick(channel: Channel): void {
        this.channelSelected.emit(channel);
    }

    onChannelActivate(channel: Channel): void {
        if (this.openOnDoubleClick()) {
            this.channelPlaybackRequested.emit(channel);
        }
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

    onDrop(event: CdkDragDrop<Channel[]>): void {
        if (this.hasSearchTerm()) {
            return;
        }

        const favorites = [...this.favorites()];
        moveItemInArray(favorites, event.previousIndex, event.currentIndex);
        this.favoritesReordered.emit(favorites.map((item) => item.url));
    }
}
