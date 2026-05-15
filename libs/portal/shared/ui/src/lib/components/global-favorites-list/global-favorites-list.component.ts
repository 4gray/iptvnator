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
import {
    ChannelDetailsDialogComponent,
    ChannelListItemComponent,
} from '@iptvnator/ui/components';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    DEFAULT_FAVORITES_CHANNEL_SORT_MODE,
    FavoritesChannelSortMode,
    sortFavoriteChannelItems,
    UnifiedFavoriteChannel,
} from '@iptvnator/portal/shared/util';
import { TranslateModule } from '@ngx-translate/core';

export interface EnrichedUnifiedFavorite extends UnifiedFavoriteChannel {
    currentEpgProgram: EpgProgram | null;
    progressPercentage: number;
}

export type GlobalFavoritesListMode = 'favorites' | 'recent';

@Component({
    selector: 'app-global-favorites-list',
    templateUrl: './global-favorites-list.component.html',
    styleUrl: './global-favorites-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListItemComponent,
        DragDropModule,
        MatIconModule,
        MatMenuModule,
        TranslateModule,
    ],
})
export class GlobalFavoritesListComponent {
    private readonly dialog = inject(MatDialog);
    private readonly settingsStore = inject(SettingsStore);

    readonly contextMenuTrigger =
        viewChild.required<MatMenuTrigger>('contextMenuTrigger');
    readonly openStreamOnDoubleClick = computed(() =>
        this.settingsStore.openStreamOnDoubleClick()
    );

    readonly channels = input.required<UnifiedFavoriteChannel[]>();
    readonly mode = input<GlobalFavoritesListMode>('favorites');
    readonly favoriteUids = input<ReadonlySet<string>>(new Set<string>());
    readonly epgMap = input<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = input<number>(0);
    readonly activeUid = input<string | null>(null);
    readonly searchTermInput = input('');
    readonly draggable = input(true);
    readonly sortMode = input<FavoritesChannelSortMode>(
        DEFAULT_FAVORITES_CHANNEL_SORT_MODE
    );

    readonly channelSelected = output<UnifiedFavoriteChannel>();
    readonly playbackRequested = output<UnifiedFavoriteChannel>();
    readonly channelsReordered = output<UnifiedFavoriteChannel[]>();
    readonly favoriteToggled = output<UnifiedFavoriteChannel>();
    readonly removeRequested = output<UnifiedFavoriteChannel>();

    readonly contextMenuChannel = signal<EnrichedUnifiedFavorite | null>(null);
    readonly contextMenuPosition = signal({
        x: '0px',
        y: '0px',
    });

    readonly isCustomSort = computed(() => this.sortMode() === 'custom');
    readonly canDragDrop = computed(
        () =>
            this.mode() === 'favorites' &&
            this.draggable() &&
            this.isCustomSort() &&
            !this.hasSearchTerm()
    );

    readonly hasSearchTerm = computed(
        () => this.searchTermInput().trim().length > 0
    );

    readonly enrichedChannels = computed((): EnrichedUnifiedFavorite[] => {
        const channels = this.channels();
        const epgMap = this.epgMap();
        const term = this.searchTermInput().trim().toLowerCase();
        this.progressTick();

        const filtered = term
            ? channels.filter((ch) => ch.name.toLowerCase().includes(term))
            : channels;

        const sorted =
            this.mode() === 'favorites'
                ? sortFavoriteChannelItems(filtered, this.sortMode(), {
                      getName: (ch) => ch.name,
                      getAddedAt: (ch) => ch.addedAt,
                  })
                : filtered;

        return sorted.map((ch) => {
            const epgKey = ch.tvgId?.trim() || ch.name?.trim();
            const currentEpgProgram = epgKey
                ? (epgMap.get(epgKey) ?? null)
                : null;
            return {
                ...ch,
                currentEpgProgram,
                progressPercentage: this.calcProgress(currentEpgProgram),
            };
        });
    });

    onChannelClick(channel: UnifiedFavoriteChannel): void {
        this.channelSelected.emit(channel);
    }

    onChannelActivate(channel: UnifiedFavoriteChannel): void {
        if (this.openStreamOnDoubleClick()) {
            this.playbackRequested.emit(channel);
        }
    }

    onFavoriteToggled(channel: UnifiedFavoriteChannel): void {
        this.favoriteToggled.emit(channel);
    }

    onChannelContextMenu(
        channel: EnrichedUnifiedFavorite,
        event: MouseEvent
    ): void {
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

    hasChannelContextMenu(channel: UnifiedFavoriteChannel): boolean {
        return Boolean(channel.m3uChannel) || this.mode() === 'recent';
    }

    openChannelDetails(): void {
        const channel = this.contextMenuChannel()?.m3uChannel;
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
        this.removeRequested.emit(channel);
    }

    isChannelFavorite(channel: UnifiedFavoriteChannel): boolean {
        return (
            this.mode() === 'favorites' || this.favoriteUids().has(channel.uid)
        );
    }

    onDrop(event: CdkDragDrop<EnrichedUnifiedFavorite[]>): void {
        if (!this.canDragDrop()) {
            return;
        }

        const list = [...this.channels()];
        moveItemInArray(list, event.previousIndex, event.currentIndex);
        this.channelsReordered.emit(list);
    }

    trackByUid(_: number, ch: EnrichedUnifiedFavorite): string {
        return ch.uid;
    }

    private calcProgress(program: EpgProgram | null | undefined): number {
        if (!program) {
            return 0;
        }

        const now = Date.now();
        const start = new Date(program.start).getTime();
        const stop = new Date(program.stop).getTime();
        const total = stop - start;
        const elapsed = now - start;
        return Math.min(100, Math.max(0, (elapsed / total) * 100));
    }
}
