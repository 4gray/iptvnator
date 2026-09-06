import { ChannelScrollFocusDirective } from '@iptvnator/ui/components';
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
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    buildStalkerEpgMappingKey,
    buildXtreamEpgMappingKey,
    EpgProgram,
    epgProviderClockMs,
} from '@iptvnator/shared/interfaces';
import { resolveChannelEpgLookupKey } from '@iptvnator/m3u-state';
import { EpgMappingDialogComponent } from '@iptvnator/ui/components';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    DEFAULT_FAVORITES_CHANNEL_SORT_MODE,
    deriveVisibleFavoriteChannels,
    FavoritesChannelSortMode,
    getXtreamCatchupDays,
    isXtreamCatchupAvailable,
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
        ChannelScrollFocusDirective,
        ChannelListItemComponent,
        DragDropModule,
        MatIconModule,
        MatMenuModule,
        TranslateModule,
    ],
})
export class GlobalFavoritesListComponent {
    private readonly dialog = inject(MatDialog);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    readonly supportsEpgMapping = this.epgBridge.supportsEpgMapping;
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);

    readonly contextMenuTrigger =
        viewChild.required<MatMenuTrigger>('contextMenuTrigger');
    readonly openStreamOnDoubleClick = computed(() =>
        this.settingsStore.openStreamOnDoubleClick()
    );

    readonly channels = input.required<UnifiedFavoriteChannel[]>();
    readonly mode = input<GlobalFavoritesListMode>('favorites');
    readonly showEpg = input(this.runtime.supportsEpg);
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
    /** Emitted after the mapping dialog closes having changed a mapping. */
    readonly epgMappingChanged = output<void>();

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
        const epgMap = this.epgMap();
        this.progressTick();

        const sorted = deriveVisibleFavoriteChannels(this.channels(), {
            searchTerm: this.searchTermInput(),
            sortMode: this.mode() === 'favorites' ? this.sortMode() : null,
            getName: (ch) => ch.name,
            getAddedAt: (ch) => ch.addedAt,
        });

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

    /** Catch-up fields arrive camelCase on unified rows — adapt for the
     *  shared snake_case helper. Only Xtream rows carry them. */
    protected catchupAvailable(channel: UnifiedFavoriteChannel): boolean {
        return isXtreamCatchupAvailable({
            tv_archive: channel.tvArchive,
            tv_archive_duration: channel.tvArchiveDuration,
        });
    }

    protected catchupDays(channel: UnifiedFavoriteChannel): number {
        return getXtreamCatchupDays({
            tv_archive_duration: channel.tvArchiveDuration,
        });
    }

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
        return (
            Boolean(channel.m3uChannel) ||
            this.mode() === 'recent' ||
            (this.supportsEpgMapping &&
                (channel.xtreamId != null ||
                    Boolean(this.stalkerItemId(channel))))
        );
    }

    openEpgMapping(): void {
        const item = this.contextMenuChannel();
        if (!item) {
            return;
        }

        this.contextMenuTrigger().closeMenu();
        const stalkerId = this.stalkerItemId(item);
        const channelKey = item.m3uChannel
            ? resolveChannelEpgLookupKey(item.m3uChannel)
            : item.xtreamId != null
              ? buildXtreamEpgMappingKey(item.playlistId, item.xtreamId)
              : stalkerId
                ? buildStalkerEpgMappingKey(item.playlistId, stalkerId)
                : null;
        if (!channelKey) {
            return;
        }

        void this.openEpgMappingDialog(channelKey, item);
    }

    private async openEpgMappingDialog(
        channelKey: string,
        item: UnifiedFavoriteChannel
    ): Promise<void> {
        const before = await this.epgBridge
            .getEpgMapping(channelKey)
            .catch(() => null);

        EpgMappingDialogComponent.open(this.dialog, {
            channelKey,
            channelName: item.name,
            playlistId: item.m3uChannel ? undefined : item.playlistId,
        })
            .afterClosed()
            .subscribe(async () => {
                const after = await this.epgBridge
                    .getEpgMapping(channelKey)
                    .catch(() => null);
                if (
                    (after?.epgChannelId ?? null) !==
                    (before?.epgChannelId ?? null)
                ) {
                    this.epgMappingChanged.emit();
                }
            });
    }

    /**
     * The stalker item id lives in the uid's third segment
     * (`stalker::{playlistId}::{stalkerId}`) — same extraction the
     * unified favorites data service uses.
     */
    private stalkerItemId(channel: UnifiedFavoriteChannel): string | null {
        if (channel.sourceType !== 'stalker') {
            return null;
        }
        const id = channel.uid.split('::')[2]?.trim();
        return id || null;
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

        // Raw programme vs. now in the provider's EPG clock; the row shifts
        // the displayed times by the same offset.
        const now = epgProviderClockMs(
            Date.now(),
            this.settingsStore.resolvedEpgOffsetMinutes()
        );
        const start = new Date(program.start).getTime();
        const stop = new Date(program.stop).getTime();
        const total = stop - start;
        const elapsed = now - start;
        return Math.min(100, Math.max(0, (elapsed / total) * 100));
    }
}
