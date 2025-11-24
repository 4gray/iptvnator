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
    Input,
    OnDestroy,
    ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import * as _ from 'lodash';
import { map, skipWhile, takeUntil } from 'rxjs';
import { Subject } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import { EpgService } from '../../../services/epg.service';
import { FilterPipe } from '../../../shared/pipes/filter.pipe';
import * as PlaylistActions from '../../../state/actions';
import {
    selectActive,
    selectActivePlaylistId,
    selectFavorites,
} from '../../../state/selectors';
import { ChannelGridContainerComponent } from '../channel-grid-container/channel-grid-container.component';
import { ChannelListItemComponent } from './channel-list-item/channel-list-item.component';

const CHANNEL_LIST_VIEW_MODE_STORAGE_KEY = 'channel-list-view-mode';

@Component({
    selector: 'app-channel-list-container',
    templateUrl: './channel-list-container.component.html',
    styleUrls: ['./channel-list-container.component.scss'],
    imports: [
        ChannelGridContainerComponent,
        ChannelListItemComponent,
        CommonModule,
        DragDropModule,
        FilterPipe,
        FormsModule,
        MatButtonToggleModule,
        MatDividerModule,
        MatExpansionModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatListModule,
        MatTabsModule,
        ScrollingModule,
        TitleCasePipe,
        TranslatePipe,
    ],
})
export class ChannelListContainerComponent implements OnDestroy {
    private readonly destroy$ = new Subject<void>();
    
    /**
     * Channels array
     * Create local copy of the store for local manipulations without updates in the store
     */
    _channelList: Channel[];
    get channelList(): Channel[] {
        return this._channelList;
    }

    @Input('channelList')
    set channelList(value: Channel[]) {
        this._channelList = value;
        // Group channels, handling undefined/null group titles as "Miscellaneous"
        this.groupedChannels = _.default.groupBy(value, (channel) => {
            const groupTitle = channel?.group?.title;
            if (!groupTitle || groupTitle.trim() === '' || groupTitle.toLowerCase() === 'undefined') {
                return 'Miscellaneous';
            }
            return groupTitle;
        });
        // Restore last watched channel when channel list changes
        if (this._channelList.length > 0) {
            setTimeout(() => this.restoreLastWatchedChannel(), 200);
        }
    }

    /** Object with channels sorted by groups */
    groupedChannels!: { [key: string]: Channel[] };

    /** Selected channel */
    selected!: Channel;

    /** Active (playing) channel ID */
    activeChannelId?: string;

    /** Last watched channel ID */
    lastWatchedChannelId?: string;

    /** Search term for channel filter */
    searchTerm: any = {
        name: '',
    };

    /** Search field element */
    @ViewChild('search') searchElement: ElementRef;

    /** Register ctrl+f as keyboard hotkey to focus the search input field */
    @HostListener('document:keypress', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent): void {
        if (event.key === 'f' && event.ctrlKey) {
            this.searchElement.nativeElement.focus();
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

    /** Current playlist ID */
    playlistId: string | undefined;

    /** List with favorites */
    favorites$ = this.store.select(selectFavorites).pipe(
        map(
            (
                favoriteChannelIds // TODO: move to selector
            ) =>
                favoriteChannelIds.map((favoriteChannelId) =>
                    this.channelList.find(
                        (channel) => channel.url === favoriteChannelId
                    )
                )
        )
    );

    @Input() hideToggle = false;
    
    private _viewMode: 'list' | 'grid' = 'list';
    get viewMode(): 'list' | 'grid' {
        // When toggle is hidden, always return 'list'
        return this.hideToggle ? 'list' : this._viewMode;
    }
    set viewMode(value: 'list' | 'grid') {
        this._viewMode = value;
    }

    constructor(
        private readonly epgService: EpgService,
        private readonly router: Router,
        private readonly snackBar: MatSnackBar,
        private readonly store: Store,
        private readonly translateService: TranslateService
    ) {
        // Load saved view mode preference
        this.loadViewModePreference();

        // Subscribe to playlist ID changes
        this.playlistId$
            .pipe(takeUntil(this.destroy$))
            .subscribe((playlistId) => {
                this.playlistId = playlistId;
            });

        // Subscribe to active channel changes for highlighting and auto-scroll
        this.store
            .select(selectActive)
            .pipe(takeUntil(this.destroy$))
            .subscribe((activeChannel) => {
                if (activeChannel?.id) {
                    this.activeChannelId = activeChannel.id;
                    // Save last watched channel
                    this.saveLastWatchedChannel(activeChannel.id);
                    // Scroll to active channel after a short delay to ensure DOM is updated
                    setTimeout(() => this.scrollToChannel(activeChannel.id), 100);
                } else {
                    this.activeChannelId = undefined;
                }
            });
    }

    /**
     * Sets clicked channel as selected and emits them to the parent component
     * @param channel selected channel
     */
    selectChannel(channel: Channel): void {
        this.selected = channel;
        this.store.dispatch(PlaylistActions.setActiveChannel({ channel }));

        const epgChannelId = channel?.name.trim();

        if (epgChannelId) {
            this.epgService.getChannelPrograms(epgChannelId);
        }

        // Navigate to video player route to play the channel
        if (this.playlistId) {
            this.router.navigate(['/playlists', this.playlistId]);
        }
    }

    setViewMode(mode: 'list' | 'grid'): void {
        this.viewMode = mode;
        this.saveViewModePreference(mode);
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
            null,
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

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
        this.store.dispatch(PlaylistActions.setChannels({ channels: [] }));
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

    private loadViewModePreference(): void {
        try {
            const savedMode = localStorage.getItem(CHANNEL_LIST_VIEW_MODE_STORAGE_KEY);
            if (savedMode === 'list' || savedMode === 'grid') {
                this._viewMode = savedMode;
            }
        } catch (error) {
            console.error('Error loading channel list view mode preference:', error);
        }
    }

    private saveViewModePreference(mode: 'list' | 'grid'): void {
        try {
            localStorage.setItem(CHANNEL_LIST_VIEW_MODE_STORAGE_KEY, mode);
        } catch (error) {
            console.error('Error saving channel list view mode preference:', error);
        }
    }

    /**
     * Scrolls to the channel with the given ID
     */
    private scrollToChannel(channelId: string): void {
        if (!channelId) return;

        // Try to find the channel in the list and scroll to it
        const channelIndex = this._channelList.findIndex(ch => ch.id === channelId);
        if (channelIndex !== -1) {
            // Use the virtual scroll viewport if available
            const viewport = document.querySelector('#all-channels .scroll-viewport') as HTMLElement;
            if (viewport) {
                // Calculate the scroll position for virtual scroll
                const itemSize = 50; // Matches itemSize in template
                const targetScroll = channelIndex * itemSize;
                viewport.scrollTo({
                    top: Math.max(0, targetScroll - 100), // Offset by 100px to show some context above
                    behavior: 'smooth'
                });
            }

            // Also try to scroll to the element in the groups list
            const channelElement = document.querySelector(`[data-channel-id="${channelId}"]`);
            if (channelElement) {
                channelElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    /**
     * Checks if a channel is currently active (playing)
     */
    isActiveChannel(channel: Channel): boolean {
        return this.activeChannelId === channel?.id;
    }

    /**
     * Checks if a channel was the last watched channel
     */
    isLastWatchedChannel(channel: Channel): boolean {
        return this.lastWatchedChannelId === channel?.id && !this.isActiveChannel(channel);
    }

    /**
     * Saves the last watched channel ID to localStorage
     */
    private saveLastWatchedChannel(channelId: string): void {
        try {
            const storageKey = `lastWatchedChannel_${this.playlistId || 'default'}`;
            localStorage.setItem(storageKey, channelId);
        } catch (error) {
            console.error('Error saving last watched channel:', error);
        }
    }

    /**
     * Restores and scrolls to the last watched channel
     */
    private restoreLastWatchedChannel(): void {
        try {
            const storageKey = `lastWatchedChannel_${this.playlistId || 'default'}`;
            const lastChannelId = localStorage.getItem(storageKey);
            
            if (lastChannelId && this._channelList.length > 0) {
                // Check if the channel still exists in the current playlist
                const channelExists = this._channelList.some(ch => ch.id === lastChannelId);
                
                if (channelExists) {
                    // Set last watched channel ID for highlighting
                    this.lastWatchedChannelId = lastChannelId;
                    // Wait for DOM to be ready, then scroll to the channel
                    setTimeout(() => {
                        this.scrollToChannel(lastChannelId);
                    }, 300);
                } else {
                    // Channel no longer exists, remove from storage
                    localStorage.removeItem(storageKey);
                    this.lastWatchedChannelId = undefined;
                }
            } else {
                this.lastWatchedChannelId = undefined;
            }
        } catch (error) {
            console.error('Error restoring last watched channel:', error);
        }
    }
}
