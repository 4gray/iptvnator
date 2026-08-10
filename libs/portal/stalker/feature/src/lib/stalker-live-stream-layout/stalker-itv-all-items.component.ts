import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    linkedSignal,
    output,
} from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import {
    GridListComponent,
    InfiniteScrollDirective,
} from '@iptvnator/portal/shared/ui';
import {
    StalkerItvChannel,
    StalkerItvLoadProgress,
} from '@iptvnator/portal/stalker/data-access';

/** Initial render window and per-`loadMore` growth over the cached list. */
const RENDER_CHUNK = 50;

/**
 * "All channels" grid shown in the Live TV main area before a category is
 * selected — mirrors the Xtream live "All Items" view. Fed by the full ITV
 * channel list cache; the render window is purely client-side so growing it
 * never touches the store's legacy page state (which would re-fire portal
 * requests).
 */
@Component({
    selector: 'app-stalker-itv-all-items',
    imports: [
        GridListComponent,
        InfiniteScrollDirective,
        MatProgressSpinnerModule,
        TranslatePipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="category-content-header">
            <div class="category-meta">
                <h2 class="category-title">
                    {{ 'PORTALS.ALL_CATEGORIES' | translate }}
                </h2>
                @if (loading()) {
                    <span class="all-items-progress" role="status">
                        <mat-spinner diameter="14" />
                        @if (progress(); as loadProgress) {
                            <span class="all-items-progress__count">
                                {{ loadProgress.loaded }}/{{
                                    loadProgress.total
                                }}
                            </span>
                        }
                    </span>
                } @else if (filteredChannels().length > 0) {
                    <span class="category-subtitle"
                        >{{ filteredChannels().length }}
                        {{
                            (filteredChannels().length === 1
                                ? 'PORTALS.ITEM'
                                : 'PORTALS.ITEMS'
                            ) | translate
                        }}</span
                    >
                }
            </div>
        </div>
        <app-grid-list
            class="all-items-grid app-scrollbar"
            appInfiniteScroll
            [infiniteHasMore]="hasMoreItems()"
            [infiniteItemCount]="visibleGridItems().length"
            [infiniteResetKey]="searchTerm()"
            (infiniteLoadMore)="loadMore()"
            [isLoading]="loading()"
            [items]="visibleGridItems()"
            [searchTerm]="searchTerm()"
            [variant]="'logo'"
            [type]="'live'"
            (itemClicked)="onItemClicked($event)"
        />
    `,
    styleUrl: './stalker-itv-all-items.component.scss',
})
export class StalkerItvAllItemsComponent {
    readonly channels = input<StalkerItvChannel[]>([]);
    readonly loading = input(false);
    readonly progress = input<StalkerItvLoadProgress | null>(null);
    readonly searchTerm = input('');

    readonly channelActivated = output<StalkerItvChannel>();

    /** Resets to the first chunk whenever the source list or search changes. */
    readonly renderLimit = linkedSignal({
        source: () => ({
            term: this.searchTerm(),
            channelCount: this.channels().length,
        }),
        computation: () => RENDER_CHUNK,
    });

    readonly filteredChannels = computed(() => {
        const term = this.searchTerm().trim().toLowerCase();
        const channels = this.channels();
        if (!term) {
            return channels;
        }

        return channels.filter((channel) =>
            `${channel.o_name ?? ''} ${channel.name ?? ''}`
                .toLowerCase()
                .includes(term)
        );
    });

    readonly hasMoreItems = computed(
        () => this.filteredChannels().length > this.renderLimit()
    );

    /** The visible window, mapped so GridListComponent can resolve the logo. */
    readonly visibleGridItems = computed(() =>
        this.filteredChannels()
            .slice(0, this.renderLimit())
            .map((channel) => {
                // GridListItem forbids null is_series; Stalker payloads may
                // carry it — drop the nullish form (same as toPlayableChannel).
                const { is_series, ...rest } = channel;
                return {
                    ...rest,
                    ...(is_series == null ? {} : { is_series }),
                    stream_icon: channel.logo,
                };
            })
    );

    loadMore(): void {
        if (!this.hasMoreItems()) {
            return;
        }

        this.renderLimit.update((limit) => limit + RENDER_CHUNK);
    }

    onItemClicked(item: unknown): void {
        this.channelActivated.emit(item as StalkerItvChannel);
    }
}
