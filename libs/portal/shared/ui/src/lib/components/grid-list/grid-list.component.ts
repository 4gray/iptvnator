import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import {
    ProgressCapsuleComponent,
    WatchedBadgeComponent,
} from '@iptvnator/ui/components';
import { PlaylistErrorViewComponent } from '../playlist-error-view/playlist-error-view.component';

interface GridListItem {
    id?: number | string;
    is_series?: number | string | boolean;
    xtream_id?: number | string;
    series_id?: number | string;
    stream_id?: number | string;
    category_id?: number | string;
    poster_url?: string;
    cover?: string;
    title?: string;
    o_name?: string;
    name?: string;
    rating?: string | number;
    rating_imdb?: string | number;
    progress?: number;
    isWatched?: boolean;
    hasSeriesProgress?: boolean;
    [key: string]: unknown;
}

export function formatGridRating(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toFixed(1);
    }

    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const numericRating = Number.parseFloat(trimmed);
    return Number.isFinite(numericRating) ? numericRating.toFixed(1) : trimmed;
}

export function resolveGridRating(
    item: Pick<GridListItem, 'rating' | 'rating_imdb'>
): string | undefined {
    return formatGridRating(item.rating_imdb) ?? formatGridRating(item.rating);
}

@Component({
    selector: 'app-grid-list',
    template: `<div class="grid-list__grid">
            @if (isLoading()) {
                @for (row of skeletonRows(); track row) {
                    <div class="grid-skeleton-card" aria-hidden="true">
                        <div class="grid-skeleton-thumb">
                            <span class="grid-skeleton-badge"></span>
                        </div>
                        <div class="grid-skeleton-title">
                            <span
                                class="grid-skeleton-line grid-skeleton-line--primary"
                            ></span>
                            <span
                                class="grid-skeleton-line grid-skeleton-line--secondary"
                            ></span>
                        </div>
                    </div>
                }
            } @else {
                @for (item of items(); track $index) {
                    @let i = $any(item);
                    <mat-card (click)="itemClicked.emit(item)">
                        @let poster = i.poster_url ?? i.cover;
                        <div class="card-thumbnail-container">
                            <img
                                class="stream-icon"
                                [src]="
                                    poster ||
                                    './assets/images/default-poster.png'
                                "
                                (error)="
                                    $event.target.src =
                                        './assets/images/default-poster.png'
                                "
                                loading="lazy"
                                alt="logo"
                            />
                            @if (i.progress && i.progress > 0) {
                                <app-progress-capsule [progress]="i.progress" />
                            }
                            @if (i.isWatched) {
                                <app-watched-badge
                                    [isWatched]="true"
                                    icon="check_circle"
                                />
                            } @else if (i.hasSeriesProgress) {
                                <app-watched-badge
                                    [isWatched]="true"
                                    icon="remove_red_eye"
                                />
                            }
                        </div>
                        @let rating = resolveRating(i);
                        @if (rating) {
                            <div
                                class="rating"
                                [matTooltip]="'XTREAM.IMDB_RATING' | translate"
                            >
                                <mat-icon>star</mat-icon>{{ rating }}
                            </div>
                        }
                        @let title = i.title ?? i.o_name ?? i.name;
                        <mat-card-actions>
                            <div class="title">
                                {{ title || 'No name' }}
                            </div>
                        </mat-card-actions>
                    </mat-card>
                } @empty {
                    <div class="grid-empty-state">
                        @if (hasActiveSearch()) {
                            <app-playlist-error-view
                                [title]="
                                    'PORTALS.SEARCH_VIEW.NO_RESULTS_FOR'
                                        | translate: { term: searchTerm() }
                                "
                                [description]="
                                    'PORTALS.EMPTY_LIST_VIEW.NO_SEARCH_RESULTS'
                                        | translate
                                "
                                [showActionButtons]="false"
                                [viewType]="'NO_SEARCH_RESULTS'"
                            />
                        } @else {
                            <app-playlist-error-view
                                [title]="
                                    'PORTALS.ERROR_VIEW.EMPTY_CATEGORY.TITLE'
                                        | translate
                                "
                                [description]="
                                    'PORTALS.ERROR_VIEW.EMPTY_CATEGORY.DESCRIPTION'
                                        | translate
                                "
                                [showActionButtons]="false"
                                [viewType]="'EMPTY_CATEGORY'"
                            />
                        }
                    </div>
                }
            }
        </div>
        @if (showPaginator() && items()?.length > 0) {
            <mat-paginator
                [pageIndex]="pageIndex()"
                [length]="totalPages() * limit()"
                [pageSize]="limit()"
                [pageSizeOptions]="pageSizeOptions()"
                (page)="pageChange.emit($event)"
                aria-label="Select page"
            />
        } `,
    styleUrl: './grid-list.component.scss',
    imports: [
        TranslatePipe,
        PlaylistErrorViewComponent,
        MatCardModule,
        MatIcon,
        MatTooltip,
        MatPaginatorModule,
        ProgressCapsuleComponent,
        WatchedBadgeComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridListComponent {
    readonly items = input<GridListItem[]>();
    readonly isLoading = input<boolean>();
    readonly showPaginator = input(true);
    readonly searchTerm = input<string>('');
    readonly itemClicked = output<GridListItem>();
    readonly pageChange = output<PageEvent>();

    readonly pageIndex = input<number>();
    readonly totalPages = input<number>();
    readonly limit = input<number>();
    readonly pageSizeOptions = input<number[]>();
    protected readonly resolveRating = resolveGridRating;
    protected readonly hasActiveSearch = computed(
        () => (this.searchTerm() ?? '').trim().length > 0
    );

    readonly skeletonRows = computed(() => {
        const preferredCount = this.limit() ?? 12;
        const count = Math.max(8, Math.min(18, preferredCount));
        return Array.from({ length: count }, (_, index) => index);
    });
}
