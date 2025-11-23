import {
    CdkDragDrop,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { CommonModule, KeyValue, TitleCasePipe } from '@angular/common';
import {
    Component,
    ElementRef,
    HostListener,
    inject,
    Input,
    OnDestroy,
    OnInit,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { FilterPipe } from '@iptvnator/pipes';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import * as _ from 'lodash';
import * as PlaylistActions from 'm3u-state';
import {
    selectActive,
    selectActivePlaylistId,
    selectFavorites,
} from 'm3u-state';
import { BehaviorSubject, combineLatest, map, skipWhile } from 'rxjs';
import { EpgService } from 'services';
import { Channel, EpgProgram, Settings, STORE_KEY } from 'shared-interfaces';
import { ChannelListItemComponent } from './channel-list-item/channel-list-item.component';

@Component({
    selector: 'app-channel-list-container',
    templateUrl: './channel-list-container.component.html',
    styleUrls: ['./channel-list-container.component.scss'],
    imports: [
        ChannelListItemComponent,
        CommonModule,
        DragDropModule,
        FilterPipe,
        FormsModule,
        MatDividerModule,
        MatExpansionModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatTabsModule,
        ScrollingModule,
        TitleCasePipe,
        TranslatePipe,
    ],
})
export class ChannelListContainerComponent implements OnInit, OnDestroy {
    private readonly epgService = inject(EpgService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly storage = inject(StorageMap);
    private readonly store = inject(Store);
    private readonly translateService = inject(TranslateService);

    /** Map of channel ID to current EPG program */
    channelEpgMap = new Map<string, EpgProgram | null>();

    /** Interval for refreshing EPG data */
    private epgRefreshInterval?: number;

    /** Whether to show EPG data in channel items (false in PWA mode or when EPG is not configured) */
    shouldShowEpg = false;

    /** Item size for virtual scroll - compact when no EPG */
    get itemSize(): number {
        return this.shouldShowEpg ? 68 : 48;
    }

    /**
     * Channels array
     * Create local copy of the store for local manipulations without updates in the store
     */
    _channelList: Channel[] = [];
    private channelList$ = new BehaviorSubject<Channel[]>([]);

    get channelList(): Channel[] {
        return this._channelList;
    }

    @Input()
    set channelList(value: Channel[]) {
        this._channelList = value;
        this.channelList$.next(value); // Emit to observable
        this.groupedChannels = _.default.groupBy(value, 'group.title');
        // Fetch EPG for new channel list
        this.fetchEpgForChannels(value);
    }

    /** Object with channels sorted by groups */
    groupedChannels!: { [key: string]: Channel[] };

    /** Selected channel */
    readonly activeChannel = this.store.selectSignal(selectActive);

    /** Search term for channel filter */
    searchTerm: { name: string } = {
        name: '',
    };

    /** Search field element */
    readonly searchElement = viewChild<ElementRef<HTMLInputElement>>('search');

    /** Register ctrl+f as keyboard hotkey to focus the search input field */
    @HostListener('document:keypress', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent): void {
        if (event.key === 'f' && event.ctrlKey) {
            this.searchElement()?.nativeElement.focus();
        }
    }

    /** ID of the current playlist */
    playlistId$ = this.store
        .select(selectActivePlaylistId)
        .pipe(
            skipWhile(
                (playlistId) => playlistId === '' || playlistId === undefined
            )
        );

    /** List with favorites - combines favorites from store with current channel list */
    favorites$ = combineLatest([
        this.store.select(selectFavorites),
        this.channelList$,
    ]).pipe(
        map(([favoriteChannelIds, channelList]) => {
            console.log(
                '[ChannelList] favorites$ emit - IDs:',
                favoriteChannelIds.length,
                'Channels:',
                channelList.length
            );
            const favorites = favoriteChannelIds
                .map((favoriteChannelId) =>
                    channelList.find(
                        (channel) => channel.url === favoriteChannelId
                    )
                )
                .filter((channel): channel is Channel => channel !== undefined); // Filter out undefined channels
            console.log(
                '[ChannelList] favorites$ result:',
                favorites.length,
                'favorites'
            );
            return favorites;
        })
    );

    /**
     * Sets clicked channel as active and dispatches to store
     * @param channel selected channel
     */
    selectChannel(channel: Channel): void {
        this.store.dispatch(PlaylistActions.setActiveChannel({ channel }));

        // Use tvg-id for EPG matching, fallback to channel name if not available
        const epgChannelId = channel?.tvg?.id?.trim() || channel?.name.trim();

        if (epgChannelId) {
            this.epgService.getChannelPrograms(epgChannelId);
        }
    }

    /**
     * Toggles favorite flag for the given channel
     * @param channel channel to update
     * @param clickEvent mouse click event
     */
    toggleFavoriteChannel(channel: Channel, clickEvent: MouseEvent): void {
        clickEvent.stopPropagation();
        this.snackBar.open(
            this.translateService.instant('CHANNELS.FAVORITES_UPDATED'),
            undefined,
            { duration: 2000 }
        );
        this.store.dispatch(PlaylistActions.updateFavorites({ channel }));
    }

    trackByFn(_: number, channel: Channel): string {
        return channel?.id;
    }

    drop(event: CdkDragDrop<Channel[]>, favorites: Channel[]) {
        moveItemInArray(favorites, event.previousIndex, event.currentIndex);
        this.store.dispatch(
            PlaylistActions.setFavorites({
                channelIds: favorites.map((item) => item.url),
            })
        );
    }

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
                        this.shouldShowEpg = !!(epgUrl && epgUrl.length > 0);
                    }
                });
        } else {
            // PWA mode - don't show EPG
            this.shouldShowEpg = false;
        }

        // Set up EPG refresh interval (every 60 seconds)
        this.epgRefreshInterval = window.setInterval(() => {
            this.fetchEpgForChannels(this._channelList);
        }, 60000);
    }

    ngOnDestroy() {
        this.store.dispatch(PlaylistActions.setChannels({ channels: [] }));

        if (this.epgRefreshInterval) {
            clearInterval(this.epgRefreshInterval);
        }

        // Clean up BehaviorSubject
        this.channelList$.complete();
    }

    /**
     * Fetches EPG data for all channels
     */
    private fetchEpgForChannels(channels: Channel[]): void {
        if (!channels || channels.length === 0) {
            console.log('[EPG] No channels to fetch EPG for');
            return;
        }

        // Get channel IDs (prefer tvg-id, fallback to name)
        const channelIds = channels
            .map((channel) => channel?.tvg?.id?.trim() || channel?.name?.trim())
            .filter((id) => !!id);

        // Batch fetch EPG programs
        this.epgService
            .getCurrentProgramsForChannels(channelIds)
            .subscribe((epgMap) => {
                this.channelEpgMap = epgMap;
            });
    }

    /**
     * Gets EPG program for a specific channel
     */
    getEpgForChannel(channel: Channel): EpgProgram | null | undefined {
        const channelId = channel?.tvg?.id?.trim() || channel?.name?.trim();
        return channelId ? this.channelEpgMap.get(channelId) : null;
    }

    groupsComparator = (
        a: KeyValue<string, any[]>,
        b: KeyValue<string, any[]>
    ): number => {
        const numA = parseInt(a.key.replace(/\D/g, ''));
        const numB = parseInt(b.key.replace(/\D/g, ''));

        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }

        return a.key.localeCompare(b.key);
    };
}
