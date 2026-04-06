import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    OnDestroy,
    OnInit,
    signal,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { ResizableDirective } from 'components';
import { PortalEmptyStateComponent } from '@iptvnator/portal/shared/ui';
import {
    PORTAL_PLAYER,
    getAdjacentChannelItem,
    getChannelItemByNumber,
    isWorkspaceLayoutRoute,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import {
    FavoriteItem,
    FavoritesService,
    XtreamUrlService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    EpgListComponent,
    EpgProgramActivationEvent,
} from '@iptvnator/ui/epg';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EpgViewComponent, WebPlayerViewComponent } from 'shared-portals';
import { EpgItem, EpgProgram } from 'shared-interfaces';
import { PortalChannelsListComponent } from '../portal-channels-list/portal-channels-list.component';
import { ActivatedRoute } from '@angular/router';

type LiveChannelSortMode = 'server' | 'name-asc' | 'name-desc';
const LIVE_CHANNEL_SORT_STORAGE_KEY = 'xtream-live-channel-sort-mode';

interface XtreamLiveChannelItem {
    readonly name?: string;
    readonly poster_url?: string;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly tv_archive?: number | null;
    readonly tv_archive_duration?: number | string | null;
    readonly xtream_id: number;
}

@Component({
    selector: 'app-live-stream-layout',
    templateUrl: './live-stream-layout.component.html',
    styleUrls: ['./live-stream-layout.component.scss'],
    imports: [
        EpgListComponent,
        EpgViewComponent,
        MatIcon,
        MatIconButton,
        MatMenuModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        PortalChannelsListComponent,
        PortalEmptyStateComponent,
        ResizableDirective,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent implements OnInit, OnDestroy {
    private readonly route = inject(ActivatedRoute);
    private readonly favoritesService = inject(FavoritesService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly xtreamUrlService = inject(XtreamUrlService);
    private readonly portalPlayer = inject(PORTAL_PLAYER);

    readonly categories = this.xtreamStore.getCategoriesBySelectedType;
    readonly categoryItemCounts = this.xtreamStore.getCategoryItemCounts;
    readonly epgItems = this.xtreamStore.epgItems;
    readonly currentEpgItem = this.xtreamStore.currentEpgItem;
    readonly isLoadingEpg = this.xtreamStore.isLoadingEpg;
    readonly selectedCategoryId = this.xtreamStore.selectedCategoryId;
    readonly liveChannelSortMode = signal<LiveChannelSortMode>('server');
    readonly isElectron = Boolean(window.electron);
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    private readonly routeSearchTerm = queryParamSignal(
        this.route,
        'q',
        (value) => (value ?? '').trim()
    );
    readonly workspaceSearchTerm = computed(() =>
        this.isWorkspaceLayout ? this.routeSearchTerm() : ''
    );
    private readonly pendingAutoOpenLiveItemId = signal<number | null>(null);
    readonly selectedLiveItem = computed<XtreamLiveChannelItem | null>(() => {
        if (this.xtreamStore.selectedContentType() !== 'live') {
            return null;
        }

        const selectedItem = this.xtreamStore.selectedItem();
        if (!selectedItem || typeof selectedItem !== 'object') {
            return null;
        }

        const item = selectedItem as XtreamLiveChannelItem;
        return item.xtream_id ? item : null;
    });
    readonly controlledEpgPrograms = computed<EpgProgram[]>(() =>
        this.epgItems().map((program) => this.toControlledEpgProgram(program))
    );
    private readonly currentTimeMs = signal(Date.now());
    readonly controlledArchiveDays = computed(() =>
        Math.max(
            0,
            Number(this.selectedLiveItem()?.tv_archive_duration ?? 0) || 0
        )
    );
    readonly archivePlaybackAvailable = computed(() => {
        const selectedItem = this.selectedLiveItem();
        return (
            Number(selectedItem?.tv_archive ?? 0) === 1 &&
            this.controlledArchiveDays() > 0
        );
    });
    readonly hasPastPrograms = computed(() => {
        const now = this.currentTimeMs();
        return this.controlledEpgPrograms().some((program) => {
            const stop = this.getProgramTimestampMilliseconds(
                program.stop,
                program.stopTimestamp
            );
            return stop !== null && stop < now;
        });
    });
    readonly showArchiveUnavailableNotice = computed(
        () =>
            this.controlledEpgPrograms().length > 0 &&
            this.hasPastPrograms() &&
            !this.archivePlaybackAvailable()
    );
    readonly liveChannelSortLabel = computed(() => {
        const mode = this.liveChannelSortMode();
        if (mode === 'name-asc') return 'Name A-Z';
        if (mode === 'name-desc') return 'Name Z-A';
        return 'Server Order';
    });

    readonly selectedCategoryInfo = computed(() => {
        const categoryId = this.selectedCategoryId();
        if (!categoryId) return null;

        const categories = this.categories();
        const category = categories?.find(
            (c) => (c.category_id ?? c.id) === categoryId
        );
        const count = this.categoryItemCounts()?.get(categoryId) ?? 0;

        return {
            name: category?.category_name ?? category?.name ?? 'Channels',
            count,
        };
    });

    private unsubscribeRemoteChannelChange?: () => void;
    private unsubscribeRemoteCommand?: () => void;

    readonly usesEmbeddedPlayer = computed(() =>
        this.portalPlayer.isEmbeddedPlayer()
    );
    readonly activeStreamUrl = signal('');
    favorites = new Map<number, boolean>();

    constructor() {
        effect((onCleanup) => {
            const intervalId = window.setInterval(() => {
                this.currentTimeMs.set(Date.now());
            }, 30_000);

            onCleanup(() => clearInterval(intervalId));
        });

        const requestedItemId = Number(
            (window.history.state as Record<string, unknown> | null)?.[
                'openXtreamLiveItemId'
            ]
        );
        if (Number.isFinite(requestedItemId) && requestedItemId > 0) {
            this.pendingAutoOpenLiveItemId.set(requestedItemId);
        }

        effect(() => {
            const pendingId = this.pendingAutoOpenLiveItemId();
            if (!pendingId) {
                return;
            }

            const channels = this.getVisibleChannels();
            if (!Array.isArray(channels) || channels.length === 0) {
                return;
            }

            const item = channels.find(
                (channel) => Number(channel?.xtream_id) === pendingId
            );
            if (!item) {
                this.pendingAutoOpenLiveItemId.set(null);
                return;
            }

            this.playLive(item);
            this.pendingAutoOpenLiveItemId.set(null);
            this.clearAutoOpenHistoryState();
        });

        effect(() => {
            if (!window.electron?.updateRemoteControlStatus) {
                return;
            }

            const selectedContentType = this.xtreamStore.selectedContentType();
            const selectedItem = this.xtreamStore.selectedItem();
            const channels = this.getVisibleChannels();
            const currentProgram = this.currentEpgItem();

            if (selectedContentType !== 'live' || !selectedItem?.xtream_id) {
                window.electron.updateRemoteControlStatus({
                    portal: 'xtream',
                    isLiveView: false,
                    supportsVolume: false,
                });
                return;
            }

            const currentIndex = channels.findIndex(
                (item) =>
                    Number(item.xtream_id) === Number(selectedItem.xtream_id)
            );

            window.electron.updateRemoteControlStatus({
                portal: 'xtream',
                isLiveView: true,
                channelName: selectedItem.title ?? selectedItem.name,
                channelNumber: currentIndex >= 0 ? currentIndex + 1 : undefined,
                epgTitle: currentProgram?.title,
                epgStart: currentProgram?.start,
                epgEnd: currentProgram?.stop ?? currentProgram?.end,
                supportsVolume: false,
            });
        });
    }

    ngOnInit() {
        if (window.electron?.onChannelChange) {
            const unsubscribe = window.electron.onChannelChange(
                (data: { direction: 'up' | 'down' }) => {
                    this.handleRemoteChannelChange(data.direction);
                }
            );
            if (typeof unsubscribe === 'function') {
                this.unsubscribeRemoteChannelChange = unsubscribe;
            }
        }
        if (window.electron?.onRemoteControlCommand) {
            const unsubscribe = window.electron.onRemoteControlCommand(
                (command) => {
                    this.handleRemoteControlCommand(command);
                }
            );
            if (typeof unsubscribe === 'function') {
                this.unsubscribeRemoteCommand = unsubscribe;
            }
        }

        const savedSortMode = localStorage.getItem(
            LIVE_CHANNEL_SORT_STORAGE_KEY
        );
        if (
            savedSortMode === 'server' ||
            savedSortMode === 'name-asc' ||
            savedSortMode === 'name-desc'
        ) {
            this.liveChannelSortMode.set(savedSortMode);
        }

        const playlist = this.xtreamStore.currentPlaylist();
        if (playlist) {
            this.favoritesService
                .getFavorites(playlist.id)
                .subscribe((favorites) => {
                    // Map using content.id instead of xtream_id
                    favorites.forEach((fav: FavoriteItem) => {
                        this.favorites.set(fav.xtream_id, true);
                    });
                });
        }
    }

    playLive(item: XtreamLiveChannelItem) {
        const streamUrl = this.xtreamStore.constructStreamUrl(item);
        this.activeStreamUrl.set(streamUrl);
        if (this.usesEmbeddedPlayer()) {
            return;
        }
        this.xtreamStore.openPlayer(
            streamUrl,
            item.title ?? item.name ?? '',
            item.poster_url ?? item.stream_icon ?? null
        );
    }

    async onProgramActivated(
        event: EpgProgramActivationEvent
    ): Promise<void> {
        const selectedItem = this.selectedLiveItem();
        if (!selectedItem?.xtream_id) {
            return;
        }

        if (event.type === 'live') {
            this.playLive(selectedItem);
            return;
        }

        await this.playCatchup(event.program, selectedItem);
    }

    setLiveChannelSortMode(mode: LiveChannelSortMode): void {
        this.liveChannelSortMode.set(mode);
        localStorage.setItem(LIVE_CHANNEL_SORT_STORAGE_KEY, mode);
    }

    ngOnDestroy(): void {
        this.unsubscribeRemoteChannelChange?.();
        this.unsubscribeRemoteCommand?.();
    }

    private handleRemoteChannelChange(direction: 'up' | 'down'): void {
        const activeItem = this.xtreamStore.selectedItem();
        if (!activeItem?.xtream_id) {
            return;
        }

        const channels = this.getVisibleChannels();
        const nextItem = getAdjacentChannelItem(
            channels,
            activeItem.xtream_id,
            direction,
            (item) => item.xtream_id
        );

        if (!nextItem) {
            return;
        }

        this.playLive(nextItem);
    }

    private handleRemoteControlCommand(command: {
        type:
            | 'channel-select-number'
            | 'volume-up'
            | 'volume-down'
            | 'volume-toggle-mute';
        number?: number;
    }): void {
        if (command.type !== 'channel-select-number' || !command.number) {
            return;
        }

        const channels = this.getVisibleChannels();
        const channel = getChannelItemByNumber(channels, command.number);
        if (!channel) {
            return;
        }

        this.playLive(channel);
    }

    private getVisibleChannels(): XtreamLiveChannelItem[] {
        return this.xtreamStore.selectItemsFromSelectedCategory() as
            XtreamLiveChannelItem[];
    }

    private async playCatchup(
        program: EpgProgram,
        item: XtreamLiveChannelItem
    ): Promise<void> {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        const startTimestamp = this.getProgramTimestampSeconds(
            program.start,
            program.startTimestamp
        );
        const stopTimestamp = this.getProgramTimestampSeconds(
            program.stop,
            program.stopTimestamp
        );

        if (!startTimestamp || !stopTimestamp) {
            return;
        }

        const catchupUrl = await this.xtreamUrlService.resolveCatchupUrl(
            playlist.id,
            {
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
            },
            item.xtream_id,
            startTimestamp,
            stopTimestamp
        );

        this.activeStreamUrl.set(catchupUrl);
        if (this.usesEmbeddedPlayer()) {
            return;
        }

        this.xtreamStore.openPlayer(
            catchupUrl,
            this.getCatchupPlaybackTitle(item, program),
            item.poster_url ?? item.stream_icon ?? null
        );
    }

    private toControlledEpgProgram(program: EpgItem): EpgProgram {
        return {
            start: program.start,
            stop: program.stop ?? program.end,
            channel: program.channel_id ?? program.id,
            title: program.title,
            desc: program.description ?? null,
            category: null,
            startTimestamp: this.getProgramTimestampSeconds(
                program.start,
                program.start_timestamp
            ),
            stopTimestamp: this.getProgramTimestampSeconds(
                program.stop ?? program.end,
                program.stop_timestamp
            ),
        };
    }

    private getProgramTimestampSeconds(
        dateValue: string,
        unixTimestampValue?: number | string | null
    ): number | null {
        const unixTimestamp = Number.parseInt(
            String(unixTimestampValue ?? ''),
            10
        );
        if (Number.isFinite(unixTimestamp) && unixTimestamp > 0) {
            return unixTimestamp;
        }

        const parsedDate = Date.parse(dateValue);
        return Number.isFinite(parsedDate)
            ? Math.floor(parsedDate / 1000)
            : null;
    }

    private getProgramTimestampMilliseconds(
        dateValue: string,
        unixTimestampValue?: number | string | null
    ): number | null {
        const unixTimestamp = this.getProgramTimestampSeconds(
            dateValue,
            unixTimestampValue
        );
        return unixTimestamp !== null ? unixTimestamp * 1000 : null;
    }

    private getCatchupPlaybackTitle(
        item: XtreamLiveChannelItem,
        program: EpgProgram
    ): string {
        const channelTitle = item.title ?? item.name ?? '';
        if (!program.title) {
            return channelTitle;
        }

        return channelTitle ? `${channelTitle} - ${program.title}` : program.title;
    }

    private clearAutoOpenHistoryState(): void {
        try {
            const state = (window.history.state ?? {}) as Record<
                string,
                unknown
            >;
            if (!('openXtreamLiveItemId' in state)) {
                return;
            }

            const nextState = { ...state };
            delete nextState['openXtreamLiveItemId'];
            delete nextState['openXtreamLiveTitle'];
            delete nextState['openXtreamLivePoster'];
            window.history.replaceState(nextState, document.title);
        } catch {
            // no-op
        }
    }
}
