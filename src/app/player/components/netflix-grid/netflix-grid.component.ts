import { CommonModule, KeyValue } from '@angular/common';
import {
    Component,
    ElementRef,
    HostListener,
    Input,
    OnDestroy,
    OnInit,
    ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import * as _ from 'lodash';
import { Subject, takeUntil } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import * as PlaylistActions from '../../../state/actions';
import { EpgService } from '../../../services/epg.service';
import { selectActive, selectActivePlaylistId, selectFavorites } from '../../../state/selectors';

@Component({
    selector: 'app-netflix-grid',
    templateUrl: './netflix-grid.component.html',
    styleUrls: ['./netflix-grid.component.scss'],
    imports: [
        CommonModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        TranslatePipe,
    ],
})
export class NetflixGridComponent implements OnInit, OnDestroy {
    private readonly destroy$ = new Subject<void>();
    private favoriteIds = new Set<string>();
    private _channelList: Channel[] = [];

    @Input()
    set channelList(value: Channel[] | null | undefined) {
        this._channelList = value ?? [];
        this.groupChannels();
        // Wait for DOM update then check scroll positions
        setTimeout(() => this.updateScrollButtons(), 0);
        // Restore last watched channel when channel list changes
        if (this._channelList.length > 0) {
            setTimeout(() => this.restoreLastWatchedChannel(), 200);
        }
    }
    get channelList(): Channel[] {
        return this._channelList;
    }

    groupedChannels: { [key: string]: Channel[] } = {};
    selectedChannelId?: string;
    activeChannelId?: string;
    lastWatchedChannelId?: string;
    scrollButtonStates: { [groupKey: string]: { left: boolean; right: boolean } } = {};
    playlistId: string | undefined;

    constructor(
        private readonly epgService: EpgService,
        private readonly router: Router,
        private readonly store: Store
    ) {
        this.store
            .select(selectFavorites)
            .pipe(takeUntil(this.destroy$))
            .subscribe((favoriteUrls) => {
                this.favoriteIds = new Set(favoriteUrls ?? []);
            });
        
        // Get the current playlist ID from store
        this.store
            .select(selectActivePlaylistId)
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
                }
            });
    }

    ngOnInit(): void {
        this.updateScrollButtons();
        // Restore and scroll to last watched channel
        this.restoreLastWatchedChannel();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    groupChannels(): void {
        this.groupedChannels = _.groupBy(
            this._channelList,
            (channel) => {
                const groupTitle = channel?.group?.title;
                // Handle undefined, null, empty string, or the literal string "undefined"
                if (!groupTitle || groupTitle.trim() === '' || groupTitle.toLowerCase() === 'undefined') {
                    return 'MISCELLANEOUS';
                }
                return groupTitle;
            }
        );
        
        // Initialize scroll button states
        Object.keys(this.groupedChannels).forEach(key => {
            if (!this.scrollButtonStates[key]) {
                this.scrollButtonStates[key] = { left: false, right: false };
            }
        });
    }

    updateScrollButtons(): void {
        Object.keys(this.groupedChannels).forEach(groupKey => {
            const scrollContainer = document.getElementById('group-' + groupKey);
            if (scrollContainer) {
                this.scrollButtonStates[groupKey] = {
                    left: scrollContainer.scrollLeft > 0,
                    right: scrollContainer.scrollLeft < 
                        (scrollContainer.scrollWidth - scrollContainer.clientWidth - 10)
                };
            }
        });
    }

    @HostListener('window:resize')
    onResize(): void {
        this.updateScrollButtons();
    }

    onScroll(groupKey: string): void {
        this.updateScrollButtons();
    }

    selectChannel(channel: Channel): void {
        if (!channel) {
            return;
        }
        this.selectedChannelId = channel.id;
        this.store.dispatch(PlaylistActions.setActiveChannel({ channel }));
        
        const epgChannelId = channel?.name?.trim();
        if (epgChannelId) {
            this.epgService.getChannelPrograms(epgChannelId);
        }

        // Navigate to video player route to play the channel
        if (this.playlistId) {
            this.router.navigate(['/playlists', this.playlistId]);
        }
    }

    toggleFavorite(channel: Channel, event: MouseEvent): void {
        event.stopPropagation();
        this.store.dispatch(PlaylistActions.updateFavorites({ channel }));
    }

    isFavorite(channel: Channel): boolean {
        return this.favoriteIds.has(channel?.url);
    }

    trackByFn(index: number, channel: Channel): string {
        return channel?.id ?? channel?.url ?? String(index);
    }

    groupsComparator = (
        a: KeyValue<string, Channel[]>,
        b: KeyValue<string, Channel[]>
    ): number => {
        // Sort miscellaneous/ungrouped to the end
        if (a.key === 'MISCELLANEOUS' || a.key === 'UNGROUPED') return 1;
        if (b.key === 'MISCELLANEOUS' || b.key === 'UNGROUPED') return -1;

        // Try numeric sorting if group names contain numbers
        const numA = parseInt(a.key.replace(/\D/g, ''));
        const numB = parseInt(b.key.replace(/\D/g, ''));

        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }

        // Alphabetical sort
        return a.key.localeCompare(b.key);
    };

    scrollGroup(groupKey: string, direction: 'left' | 'right', event: MouseEvent): void {
        event.stopPropagation();
        const scrollContainer = document.getElementById('group-' + groupKey);
        if (!scrollContainer) return;

        const scrollAmount = 800; // Pixels to scroll
        const targetScroll = direction === 'left' 
            ? scrollContainer.scrollLeft - scrollAmount
            : scrollContainer.scrollLeft + scrollAmount;

        scrollContainer.scrollTo({
            left: targetScroll,
            behavior: 'smooth'
        });

        // Update button states after scroll animation
        setTimeout(() => this.updateScrollButtons(), 300);
    }

    canScrollLeft(groupKey: string): boolean {
        return this.scrollButtonStates[groupKey]?.left ?? false;
    }

    canScrollRight(groupKey: string): boolean {
        return this.scrollButtonStates[groupKey]?.right ?? false;
    }

    getGroupDisplayName(groupKey: string): string {
        if (groupKey === 'UNGROUPED') {
            return 'CHANNELS.UNGROUPED';
        }
        if (groupKey === 'MISCELLANEOUS' || !groupKey || groupKey.toLowerCase() === 'undefined') {
            return 'Miscellaneous';
        }
        return groupKey;
    }

    /**
     * Scrolls to the channel with the given ID
     */
    scrollToChannel(channelId: string): void {
        if (!channelId) return;

        // Find which group contains this channel
        for (const [groupKey, channels] of Object.entries(this.groupedChannels)) {
            const channelIndex = channels.findIndex(ch => ch.id === channelId);
            if (channelIndex !== -1) {
                // Found the channel, scroll to it
                const scrollContainer = document.getElementById('group-' + groupKey);
                const channelElement = document.querySelector(`[data-channel-id="${channelId}"]`);
                
                if (scrollContainer && channelElement) {
                    // Calculate position to center the channel in view
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const elementRect = channelElement.getBoundingClientRect();
                    const relativeLeft = elementRect.left - containerRect.left;
                    const scrollLeft = scrollContainer.scrollLeft + relativeLeft - (containerRect.width / 2) + (elementRect.width / 2);
                    
                    scrollContainer.scrollTo({
                        left: Math.max(0, scrollLeft),
                        behavior: 'smooth'
                    });

                    // Also scroll the page if needed to bring the row into view
                    const rowElement = scrollContainer.closest('.channel-row');
                    if (rowElement) {
                        rowElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }
                break;
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

