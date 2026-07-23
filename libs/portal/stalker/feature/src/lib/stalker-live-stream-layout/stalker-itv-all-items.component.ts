import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    linkedSignal,
    output,
    signal,
} from '@angular/core';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { GridListComponent } from '@iptvnator/portal/shared/ui';
import {
    StalkerItvChannel,
    StalkerItvLoadProgress,
} from '@iptvnator/portal/stalker/data-access';

/**
 * "All channels" grid shown in the Live TV main area before a category is
 * selected — mirrors the Xtream live "All Items" view. Fed by the full ITV
 * channel list cache; pagination is purely client-side so it never touches the
 * store's legacy page state (which would re-fire portal requests).
 */
@Component({
    selector: 'app-stalker-itv-all-items',
    imports: [
        GridListComponent,
        MatPaginatorModule,
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
            @if (!loading() && filteredChannels().length > 0) {
                <mat-paginator
                    [pageIndex]="pageIndex()"
                    [length]="filteredChannels().length"
                    [pageSize]="pageSize()"
                    [pageSizeOptions]="pageSizeOptions"
                    (page)="onPageChange($event)"
                    aria-label="Select page"
                />
            }
        </div>
        <app-grid-list
            class="all-items-grid app-scrollbar"
            [isLoading]="loading()"
            [items]="pagedGridItems()"
            [limit]="pageSize()"
            [showPaginator]="false"
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

    readonly pageSizeOptions = [10, 25, 50, 100];
    readonly pageSize = signal(25);
    /** Resets to the first page whenever the source list or search changes. */
    readonly pageIndex = linkedSignal({
        source: () => ({
            term: this.searchTerm(),
            channelCount: this.channels().length,
        }),
        computation: () => 0,
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

    /** The current page, mapped so GridListComponent can resolve the logo. */
    readonly pagedGridItems = computed(() => {
        const start = this.pageIndex() * this.pageSize();
        return this.filteredChannels()
            .slice(start, start + this.pageSize())
            .map((channel) => {
                // GridListItem forbids null is_series; Stalker payloads may
                // carry it — drop the nullish form (same as toPlayableChannel).
                const { is_series, ...rest } = channel;
                return {
                    ...rest,
                    ...(is_series == null ? {} : { is_series }),
                    stream_icon: channel.logo,
                };
            });
    });

    onPageChange(event: PageEvent): void {
        this.pageSize.set(event.pageSize);
        this.pageIndex.set(event.pageIndex);
    }

    onItemClicked(item: unknown): void {
        this.channelActivated.emit(item as StalkerItvChannel);
    }
}
