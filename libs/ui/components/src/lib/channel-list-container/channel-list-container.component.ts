import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    Input,
    OnDestroy,
    OnInit,
    signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import * as _ from 'lodash';
import {
    ChannelActions,
    FavoritesActions,
    selectActive,
    selectActivePlaylistId,
    selectFavorites,
} from 'm3u-state';
import { BehaviorSubject, combineLatest, map, skipWhile } from 'rxjs';
import { EpgService } from 'services';
import {
    Channel,
    EpgProgram,
    GLOBAL_FAVORITES_PLAYLIST_ID,
    Settings,
    STORE_KEY,
} from 'shared-interfaces';
import { AllChannelsTabComponent } from './all-channels-tab/all-channels-tab.component';
import { FavoritesTabComponent } from './favorites-tab/favorites-tab.component';
import { GroupsTabComponent } from './groups-tab/groups-tab.component';

@Component({
    selector: 'app-channel-list-container',
    templateUrl: './channel-list-container.component.html',
    styleUrls: ['./channel-list-container.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        AllChannelsTabComponent,
        CommonModule,
        FavoritesTabComponent,
        GroupsTabComponent,
        MatIconModule,
        MatTabsModule,
        TranslatePipe,
    ],
})
export class ChannelListContainerComponent implements OnInit, OnDestroy {
    private readonly epgService = inject(EpgService);
    private readonly storage = inject(StorageMap);
    private readonly store = inject(Store);

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

    /** Channels array */
    _channelList: Channel[] = [];
    private readonly channelListSignal = signal<Channel[]>([]);
    private channelList$ = new BehaviorSubject<Channel[]>([]);

    get channelList(): Channel[] {
        return this._channelList;
    }

    @Input()
    set channelList(value: Channel[]) {
        this._channelList = value;
        this.channelListSignal.set(value);
        this.channelList$.next(value);
        this.fetchEpgForChannels(value);
    }

    /** Active playlist ID as signal */
    private readonly activePlaylistIdSignal =
        this.store.selectSignal(selectActivePlaylistId);

    /** Displayed channels - filters out unfavorited channels in global favorites view */
    readonly displayedChannels = computed(() => {
        const channels = this.channelListSignal();
        if (this.activePlaylistIdSignal() === GLOBAL_FAVORITES_PLAYLIST_ID) {
            return channels.filter((ch) => this.favoriteIds().has(ch.url));
        }
        return channels;
    });

    /** Object with channels sorted by groups */
    readonly groupedChannels = computed(() =>
        _.default.groupBy(this.displayedChannels(), 'group.title')
    );

    /** Selected channel */
    readonly activeChannel = this.store.selectSignal(selectActive);

    /** Active channel URL for highlighting */
    readonly activeChannelUrl = computed(() => this.activeChannel()?.url);

    /** ID of the current playlist */
    playlistId$ = this.store
        .select(selectActivePlaylistId)
        .pipe(
            skipWhile(
                (playlistId) => playlistId === '' || playlistId === undefined
            )
        );

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

        const epgChannelId = channel?.tvg?.id?.trim() || channel?.name.trim();
        if (epgChannelId) {
            this.epgService.getChannelPrograms(epgChannelId);
        }
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
}
