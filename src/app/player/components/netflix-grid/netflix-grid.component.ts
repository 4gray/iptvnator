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
import { selectFavorites } from '../../../state/selectors';

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
    }
    get channelList(): Channel[] {
        return this._channelList;
    }

    groupedChannels: { [key: string]: Channel[] } = {};
    selectedChannelId?: string;
    scrollButtonStates: { [groupKey: string]: { left: boolean; right: boolean } } = {};

    constructor(
        private readonly epgService: EpgService,
        private readonly store: Store
    ) {
        this.store
            .select(selectFavorites)
            .pipe(takeUntil(this.destroy$))
            .subscribe((favoriteUrls) => {
                this.favoriteIds = new Set(favoriteUrls ?? []);
            });
    }

    ngOnInit(): void {
        this.updateScrollButtons();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    groupChannels(): void {
        this.groupedChannels = _.groupBy(
            this._channelList,
            (channel) => channel?.group?.title || 'UNGROUPED'
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
        // Sort ungrouped to the end
        if (a.key === 'UNGROUPED') return 1;
        if (b.key === 'UNGROUPED') return -1;

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
        return groupKey === 'UNGROUPED' 
            ? 'CHANNELS.UNGROUPED' 
            : groupKey;
    }
}

