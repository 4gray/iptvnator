import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    Input,
    input,
    OnDestroy,
    OnInit,
    output,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    isWorkspaceLayoutRoute,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import {
    ChannelActions,
    FavoritesActions,
    PlaylistActions,
    selectActive,
    selectFavorites,
} from 'm3u-state';
import {
    BehaviorSubject,
    combineLatest,
    filter,
    firstValueFrom,
    map,
} from 'rxjs';
import { PlaylistsService } from 'services';
import {
    Channel,
    EpgProgram,
    isM3uRecentlyViewedItem,
    normalizeStalkerDate,
    PlaylistMeta,
    PlaylistRecentlyViewedItem,
    Settings,
    STORE_KEY,
} from 'shared-interfaces';
import { AllChannelsViewComponent } from './all-channels-view/all-channels-view.component';
import { FavoritesViewComponent } from './favorites-view/favorites-view.component';
import { GroupsViewComponent } from './groups-view/groups-view.component';
import {
    RecentViewComponent,
    RecentViewItem,
} from './recent-view/recent-view.component';

function groupChannelsByTitle(channels: Channel[]): Record<string, Channel[]> {
    return channels.reduce<Record<string, Channel[]>>((groups, channel) => {
        const key = channel.group?.title ?? '';
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(channel);
        return groups;
    }, {});
}

@Component({
    selector: 'app-channel-list-container',
    templateUrl: './channel-list-container.component.html',
    styleUrls: ['./channel-list-container.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AllChannelsViewComponent,
        CommonModule,
        FavoritesViewComponent,
        GroupsViewComponent,
        MatButtonModule,
        MatIconModule,
        RecentViewComponent,
        TranslatePipe,
    ],
})
export class ChannelListContainerComponent implements OnInit, OnDestroy {
    private readonly epgService = inject(EpgService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly storage = inject(StorageMap);
    private readonly store = inject(Store);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly playlistContext = inject(PlaylistContextFacade);

    /** Map of channel ID to current EPG program */
    readonly channelEpgMap = signal(new Map<string, EpgProgram | null>());

    /** Interval for refreshing EPG data */
    private epgRefreshInterval?: number;

    /** Global progress tick signal - triggers re-computation of progress percentages */
    readonly progressTick = signal(0);

    /** Interval for global progress updates */
    private progressInterval?: number;

    /** Whether to show EPG data in channel items */
    readonly shouldShowEpg = signal(false);

    /** Item size for virtual scroll - compact when no EPG */
    readonly itemSize = computed(() => (this.shouldShowEpg() ? 68 : 48));

    /** Active view (all, groups, favorites, recent) */
    readonly activeView = input<string>('all');
    readonly recentItems = input<PlaylistRecentlyViewedItem[]>([]);
    readonly sidebarWidth = input<number | null>(null);
    readonly sidebarWidthRequested = output<number>();
    readonly sidebarWidthRequestEnded = output<number>();
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.route);
    private readonly routeSearchTerm = queryParamSignal(
        this.route,
        'q',
        (value) => (value ?? '').trim().toLowerCase()
    );
    readonly workspaceSearchTerm = computed(() =>
        this.isWorkspaceLayout ? this.routeSearchTerm() : ''
    );

    readonly currentUrl = toSignal(
        this.router.events.pipe(
            filter((event) => event instanceof NavigationEnd),
            map((event) => (event as NavigationEnd).urlAfterRedirects)
        ),
        { initialValue: this.router.url }
    );

    readonly viewTitle = computed(() => {
        const view = this.activeView();
        const url = this.currentUrl();
        if (view === 'all') return 'CHANNELS.ALL_CHANNELS';
        if (view === 'groups') return 'CHANNELS.GROUPS';
        if (view === 'recent') return 'PORTALS.SIDEBAR.RECENT';
        if (view === 'favorites') {
            return url.includes('/workspace/global-favorites')
                ? 'HOME.PLAYLISTS.GLOBAL_FAVORITES'
                : 'CHANNELS.FAVORITES';
        }
        return '';
    });

    /** Channels array */
    _channelList: Channel[] = [];
    private readonly channelListSignal = signal<Channel[]>([]);
    private channelList$ = new BehaviorSubject<Channel[]>([]);

    get channelList(): Channel[] {
        return this._channelList;
    }

    @Input()
    set channelList(value: Channel[]) {
        const safeValue = value ?? [];
        this._channelList = safeValue;
        this.channelListSignal.set(safeValue);
        this.channelList$.next(safeValue);
        this.fetchEpgForChannels(safeValue);
    }

    /** Route-aware playlist ID for recent-item mutations */
    private readonly resolvedPlaylistId = this.playlistContext.resolvedPlaylistId;

    /** Displayed channels - filters out unfavorited channels in global favorites view */
    readonly displayedChannels = computed(() => {
        return this.channelListSignal();
    });

    /** Object with channels sorted by groups */
    readonly groupedChannels = computed(() =>
        groupChannelsByTitle(this.displayedChannels())
    );

    readonly recentChannelItems = computed<RecentViewItem[]>(() => {
        const channels = this.channelListSignal();
        const recentItems = this.recentItems();
        const channelsByUrl = new Map(
            channels.map((channel) => [channel.url, channel] as const)
        );
        const channelsById = new Map(
            channels.map((channel) => [channel.id, channel] as const)
        );
        const seenUrls = new Set<string>();

        return [...recentItems]
            .filter(isM3uRecentlyViewedItem)
            .sort(
                (a, b) =>
                    new Date(normalizeStalkerDate(b.added_at)).getTime() -
                    new Date(normalizeStalkerDate(a.added_at)).getTime()
            )
            .reduce<RecentViewItem[]>((acc, item) => {
                const channelUrl = item.url?.trim();
                if (!channelUrl || seenUrls.has(channelUrl)) {
                    return acc;
                }

                const channel =
                    channelsByUrl.get(channelUrl) ||
                    (item.channel_id
                        ? channelsById.get(item.channel_id)
                        : undefined);

                if (!channel) {
                    return acc;
                }

                seenUrls.add(channel.url);
                acc.push({
                    channel,
                    viewedAt: normalizeStalkerDate(item.added_at),
                });
                return acc;
            }, []);
    });

    /** Selected channel */
    readonly activeChannel = this.store.selectSignal(selectActive);

    /** Active channel URL for highlighting */
    readonly activeChannelUrl = computed(() => this.activeChannel()?.url);

    /** Set of favorite channel URLs for quick lookup */
    private readonly _favorites = this.store.selectSignal(selectFavorites);
    readonly favoriteIds = computed(() => new Set(this._favorites()));

    /** List with favorites */
    favorites$ = combineLatest([
        this.store.select(selectFavorites),
        this.channelList$,
    ]).pipe(
        map(([favoriteChannelIds, channelList]) => {
            return favoriteChannelIds
                .map((favoriteChannelId) =>
                    channelList.find(
                        (channel) => channel.url === favoriteChannelId
                    )
                )
                .filter((channel): channel is Channel => channel !== undefined);
        })
    );

    ngOnInit(): void {
        // Check if EPG should be shown (only in Electron with configured EPG URL)
        const isElectron = !!window['electron'];
        if (isElectron) {
            this.storage
                .get(STORE_KEY.Settings)
                .subscribe((settings: unknown) => {
                    if (
                        settings &&
                        Object.keys(settings as Settings).length > 0
                    ) {
                        const epgUrl = (settings as Settings).epgUrl;
                        this.shouldShowEpg.set(!!(epgUrl && epgUrl.length > 0));
                    }
                });
        } else {
            this.shouldShowEpg.set(false);
        }

        // Set up EPG refresh interval (every 60 seconds)
        this.epgRefreshInterval = window.setInterval(() => {
            this.fetchEpgForChannels(this._channelList);
        }, 60000);

        // Set up global progress update interval (every 30 seconds)
        this.progressInterval = window.setInterval(() => {
            this.progressTick.update((v) => v + 1);
        }, 30000);
    }

    ngOnDestroy(): void {
        this.store.dispatch(ChannelActions.resetActiveChannel());
        this.store.dispatch(ChannelActions.setChannels({ channels: [] }));

        if (this.epgRefreshInterval) {
            clearInterval(this.epgRefreshInterval);
        }

        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }

        this.channelList$.complete();
    }

    /**
     * Fetches EPG data for all channels
     */
    private fetchEpgForChannels(channels: Channel[]): void {
        if (!channels || channels.length === 0) {
            return;
        }

        const channelIds = channels
            .map((channel) => channel?.tvg?.id?.trim() || channel?.name?.trim())
            .filter((id) => !!id);

        this.epgService
            .getCurrentProgramsForChannels(channelIds)
            .subscribe((epgMap) => {
                this.channelEpgMap.set(epgMap);
            });
    }

    /**
     * Handles channel selection from any tab
     */
    onChannelSelected(channel: Channel): void {
        this.store.dispatch(ChannelActions.setActiveChannel({ channel }));
    }

    /**
     * Handles favorite toggle from favorites tab
     */
    onFavoriteToggled(event: { channel: Channel; event: MouseEvent }): void {
        event.event.stopPropagation();
        this.store.dispatch(
            FavoritesActions.updateFavorites({ channel: event.channel })
        );
    }

    /**
     * Handles favorites reorder from drag-drop
     */
    onFavoritesReordered(channelIds: string[]): void {
        this.store.dispatch(FavoritesActions.setFavorites({ channelIds }));
    }

    async removeRecentChannel(channelUrl: string): Promise<void> {
        const playlistId = this.resolvedPlaylistId();
        if (!playlistId) {
            return;
        }

        const updatedPlaylist = await firstValueFrom(
            this.playlistsService.removeFromM3uRecentlyViewed(
                playlistId,
                channelUrl
            )
        );

        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: playlistId,
                    recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                } as PlaylistMeta,
            }) as any
        );
    }

    async clearRecentChannels(): Promise<void> {
        const playlistId = this.resolvedPlaylistId();
        if (!playlistId) {
            return;
        }

        const updatedPlaylist = await firstValueFrom(
            this.playlistsService.clearM3uRecentlyViewed(playlistId)
        );

        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: playlistId,
                    recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                } as PlaylistMeta,
            }) as any
        );
    }

    onSidebarWidthRequested(width: number): void {
        this.sidebarWidthRequested.emit(width);
    }

    onSidebarWidthRequestEnded(width: number): void {
        this.sidebarWidthRequestEnded.emit(width);
    }
}
