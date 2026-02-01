import { ScrollingModule } from '@angular/cdk/scrolling';
import { CommonModule } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    HostListener,
    input,
    OnDestroy,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel, EpgProgram } from 'shared-interfaces';
import { ChannelListItemComponent } from '../channel-list-item/channel-list-item.component';

/** Enriched channel with pre-computed EPG and progress data */
export interface EnrichedChannel extends Channel {
    epgProgram: EpgProgram | null | undefined;
    progressPercentage: number;
}

@Component({
    selector: 'app-all-channels-tab',
    templateUrl: './all-channels-tab.component.html',
    styleUrls: ['./all-channels-tab.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        ChannelListItemComponent,
        CommonModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        ScrollingModule,
        TranslatePipe,
    ],
})
export class AllChannelsTabComponent implements OnDestroy {
    /** All channels (will be filtered by search) */
    readonly channels = input.required<Channel[]>();

    /** EPG map for channel enrichment */
    readonly channelEpgMap = input.required<Map<string, EpgProgram | null>>();

    /** Progress tick to trigger progress recalculation */
    readonly progressTick = input.required<number>();

    /** Whether to show EPG data */
    readonly shouldShowEpg = input.required<boolean>();

    /** Item size for virtual scroll */
    readonly itemSize = input.required<number>();

    /** Currently active channel URL */
    readonly activeChannelUrl = input<string | undefined>();

    /** Set of favorite channel URLs */
    readonly favoriteIds = input<Set<string>>(new Set());

    /** Emits when a channel is selected */
    readonly channelSelected = output<Channel>();

    /** Emits when favorite is toggled */
    readonly favoriteToggled = output<{
        channel: Channel;
        event: MouseEvent;
    }>();

    /** Search term signal for debounced filtering */
    readonly searchTerm = signal('');

    /** Debounce timeout for search */
    private searchDebounceTimeout?: number;

    /** Search field element */
    readonly searchElement = viewChild<ElementRef<HTMLInputElement>>('search');

    /** Register ctrl+f as keyboard hotkey to focus the search input field */
    @HostListener('document:keypress', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent): void {
        if (event.key === 'f' && event.ctrlKey) {
            this.searchElement()?.nativeElement.focus();
        }
    }

    /**
     * Computed signal for filtered and enriched channels.
     */
    readonly enrichedChannels = computed(() => {
        const term = this.searchTerm().toLowerCase();
        const channels = this.channels();
        const epgMap = this.channelEpgMap();
        // Read progressTick to create dependency for progress refresh
        this.progressTick();

        let result = channels;

        // Filter if search term exists
        if (term) {
            result = channels.filter((ch) =>
                ch.name?.toLowerCase().includes(term)
            );
        }

        // Enrich with EPG data and pre-calculate progress
        return result.map((channel) => {
            const channelId = channel?.tvg?.id?.trim() || channel?.name?.trim();
            const epgProgram = channelId ? epgMap.get(channelId) : null;
            return {
                ...channel,
                epgProgram,
                progressPercentage: this.calculateProgress(epgProgram),
            } as EnrichedChannel;
        });
    });

    /**
     * Handles debounced search input
     */
    onSearchInput(value: string): void {
        clearTimeout(this.searchDebounceTimeout);
        this.searchDebounceTimeout = window.setTimeout(() => {
            this.searchTerm.set(value);
        }, 300);
    }

    /**
     * Calculates progress percentage for an EPG program
     */
    private calculateProgress(
        epgProgram: EpgProgram | null | undefined
    ): number {
        if (!epgProgram) {
            return 0;
        }

        const now = new Date().getTime();
        const start = new Date(epgProgram.start).getTime();
        const stop = new Date(epgProgram.stop).getTime();

        const total = stop - start;
        const elapsed = now - start;

        return Math.min(100, Math.max(0, (elapsed / total) * 100));
    }

    trackByFn(_: number, channel: Channel): string {
        return channel?.id;
    }

    onChannelClick(channel: Channel): void {
        this.channelSelected.emit(channel);
    }

    onFavoriteToggle(channel: Channel, event: MouseEvent): void {
        this.favoriteToggled.emit({ channel, event });
    }

    ngOnDestroy(): void {
        if (this.searchDebounceTimeout) {
            clearTimeout(this.searchDebounceTimeout);
        }
    }
}
