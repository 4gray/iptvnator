import { FavoriteFoldersToolbarComponent } from '../favorite-channel-folders/favorite-folders-toolbar.component';
import type { FavoriteFoldersView } from '../favorite-channel-folders/favorite-folders-view';
import { isCatalogUnavailable } from '@iptvnator/shared/interfaces';
import {
    ChannelContextMenuComponent,
    ChannelScrollFocusDirective,
} from '@iptvnator/ui/components';
import {
    CdkDragDrop,
    CdkDragRelease,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    HostListener,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import {
    ChannelDetailsDialogComponent,
    ChannelListItemComponent,
} from '@iptvnator/ui/components';
import {
    EpgPreferencesService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import {
    buildStalkerEpgMappingKey,
    buildXtreamEpgMappingKey,
    EpgProgram,
    epgProviderClockMs,
    playlistDisplayLabel,
} from '@iptvnator/shared/interfaces';
import { resolveChannelEpgLookupKey } from '@iptvnator/m3u-state';
import { APP_ICONS, EpgMappingDialogComponent } from '@iptvnator/ui/components';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    DEFAULT_FAVORITES_CHANNEL_SORT_MODE,
    deriveVisibleFavoriteChannels,
    FavoritesChannelSortMode,
    getLiveCollectionPlaylistNavigation,
    getXtreamCatchupDays,
    isXtreamCatchupAvailable,
    UnifiedFavoriteChannel,
    collectionEpgKey,
} from '@iptvnator/portal/shared/util';
import { TranslateModule } from '@ngx-translate/core';
import { StateViewComponent } from '@iptvnator/ui/state';

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
        StateViewComponent,
        FavoriteFoldersToolbarComponent,
        ChannelContextMenuComponent,
        ChannelScrollFocusDirective,
        ChannelListItemComponent,
        DragDropModule,
        MatIconModule,
        TranslateModule,
    ],
})
export class GlobalFavoritesListComponent {
    protected readonly appIcons = APP_ICONS;
    private readonly dialog = inject(MatDialog);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    get supportsEpgMapping(): boolean {
        return (
            this.epgPreferences.enabled() && this.epgBridge.supportsEpgMapping
        );
    }
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly epgPreferences = inject(EpgPreferencesService);
    private readonly settingsStore = inject(SettingsStore);

    readonly channelContextMenu = viewChild.required(
        ChannelContextMenuComponent
    );
    readonly openStreamOnDoubleClick = computed(() =>
        this.settingsStore.openStreamOnDoubleClick()
    );

    readonly channels = input.required<UnifiedFavoriteChannel[]>();
    readonly mode = input<GlobalFavoritesListMode>('favorites');
    readonly folderView = input<FavoriteFoldersView | null>(null);
    /** Host switch for programme lines; each row also needs its guide. */
    readonly showEpg = input(true);
    /**
     * Which rows can carry a programme line: M3U rows need XMLTV, Xtream
     * and Stalker rows read their provider's guide (also in the PWA).
     */
    protected get guideBySource() {
        return {
            m3u: this.epgPreferences.enabled() && this.runtime.supportsEpg,
            xtream:
                this.epgPreferences.enabled() &&
                this.runtime.supportsProviderEpg,
            stalker:
                this.epgPreferences.enabled() &&
                this.runtime.supportsProviderEpg,
        };
    }
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
    /** Row asks to be opened inside its owning playlist (host navigates). */
    readonly openInPlaylistRequested = output<UnifiedFavoriteChannel>();
    /** Emitted after the mapping dialog closes having changed a mapping. */
    readonly epgMappingChanged = output<void>();

    readonly contextMenuChannel = signal<EnrichedUnifiedFavorite | null>(null);
    private isDragging = false;
    private dragCancelled = false;
    private releasedFolderId: string | null = null;
    readonly contextMenuUnavailable = computed(() => {
        const channel = this.contextMenuChannel();
        return !!channel && isCatalogUnavailable(channel);
    });
    readonly contextMenuCanOpenInPlaylist = computed(() => {
        const channel = this.contextMenuChannel();
        return !!channel && this.canOpenInPlaylist(channel);
    });
    readonly contextMenuPlaylistName = computed(() =>
        playlistDisplayLabel(this.contextMenuChannel()?.playlistName)
    );

    readonly isCustomSort = computed(() => this.sortMode() === 'custom');
    readonly canDragDrop = computed(
        () =>
            this.mode() === 'favorites' &&
            this.draggable() &&
            this.isCustomSort() &&
            !this.hasSearchTerm() &&
            !this.folderView()?.selectionMode()
    );

    readonly canDragToFolder = computed(
        () => this.draggable() && !!this.folderView()?.canDragToFolder()
    );

    protected onDragStarted(channel: UnifiedFavoriteChannel): void {
        this.isDragging = true;
        this.dragCancelled = false;
        this.releasedFolderId = null;
        this.folderView()?.startDrag(channel);
    }

    protected onDragReleased({ event }: CdkDragRelease): void {
        this.isDragging = false;
        if (!this.dragCancelled) {
            this.releasedFolderId =
                this.folderView()?.destinationAt(event) ?? null;
        }
    }

    protected onDragEnded(channel: UnifiedFavoriteChannel): void {
        // CDK completes its animation before restoring the row's DOM.
        const destination = this.releasedFolderId;
        this.releasedFolderId = null;
        void this.folderView()?.endDrag(channel, destination);
    }

    @HostListener('document:keydown.escape', ['$event'])
    protected cancelDrag(event: Event): void {
        if (!this.isDragging || !this.folderView()) return;
        event.preventDefault();
        this.dragCancelled = true;
        this.folderView()?.clearDrag();
    }

    protected onSelectionEscape(event: Event): void {
        const folders = this.folderView();
        if (!folders?.selectionMode() || this.dialog.openDialogs.length) return;
        event.stopPropagation();
        event.preventDefault();
        folders.finishSelection();
    }

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
            const epgKey = collectionEpgKey(ch);
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

    readonly isUnavailable = isCatalogUnavailable;

    onPlaybackRequested(channel: UnifiedFavoriteChannel): void {
        if (this.folderView()?.selectionMode()) {
            this.onChannelClick(channel);
            return;
        }
        if (!isCatalogUnavailable(channel))
            this.playbackRequested.emit(channel);
    }

    onChannelClick(channel: UnifiedFavoriteChannel): void {
        const folders = this.folderView();
        if (folders?.selectionMode()) {
            if (folders.canFile(channel)) folders.toggleSelected(channel.uid);
            return;
        }
        if (isCatalogUnavailable(channel)) return;
        this.channelSelected.emit(channel);
    }

    onChannelActivate(channel: UnifiedFavoriteChannel): void {
        if (
            !this.folderView()?.selectionMode() &&
            this.openStreamOnDoubleClick() &&
            !isCatalogUnavailable(channel)
        ) {
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
        this.channelContextMenu().open(event);
    }

    hasChannelContextMenu(channel: UnifiedFavoriteChannel): boolean {
        if (this.folderView()?.canFile(channel)) return true;
        if (isCatalogUnavailable(channel)) return this.mode() === 'recent';
        return (
            Boolean(channel.m3uChannel) ||
            this.mode() === 'recent' ||
            this.canOpenInPlaylist(channel) ||
            (this.supportsEpgMapping &&
                (channel.xtreamId != null ||
                    Boolean(this.stalkerItemId(channel))))
        );
    }

    canOpenInPlaylist(channel: UnifiedFavoriteChannel): boolean {
        if (isCatalogUnavailable(channel)) return false;
        return getLiveCollectionPlaylistNavigation(channel) !== null;
    }

    openContextMenuChannelInPlaylist(): void {
        const channel = this.contextMenuChannel();
        if (!channel || !this.canOpenInPlaylist(channel)) {
            return;
        }

        this.channelContextMenu().close();
        this.openInPlaylistRequested.emit(channel);
    }

    openEpgMapping(): void {
        const item = this.contextMenuChannel();
        if (!item || isCatalogUnavailable(item)) {
            return;
        }

        this.channelContextMenu().close();
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

    private stalkerItemId(channel: UnifiedFavoriteChannel): string | null {
        if (channel.sourceType !== 'stalker') {
            return null;
        }
        const id = String(channel.stalkerId ?? '').trim();
        return id || null;
    }

    openChannelDetails(): void {
        const item = this.contextMenuChannel();
        const channel = item?.m3uChannel;
        if (!channel || (item && isCatalogUnavailable(item))) {
            return;
        }

        this.channelContextMenu().close();
        ChannelDetailsDialogComponent.open(this.dialog, channel);
    }

    removeContextMenuChannel(): void {
        const channel = this.contextMenuChannel();
        if (!channel) {
            return;
        }

        this.channelContextMenu().close();
        this.removeRequested.emit(channel);
    }

    moveContextMenuChannel(): void {
        const channel = this.contextMenuChannel();
        if (channel) void this.folderView()?.moveOne(channel);
    }

    isChannelFavorite(channel: UnifiedFavoriteChannel): boolean {
        return (
            this.mode() === 'favorites' || this.favoriteUids().has(channel.uid)
        );
    }

    onDrop(event: CdkDragDrop<EnrichedUnifiedFavorite[]>): void {
        if (
            this.dragCancelled ||
            !this.canDragDrop() ||
            !event.isPointerOverContainer ||
            event.previousIndex === event.currentIndex
        ) {
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
