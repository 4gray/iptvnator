import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
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
    stream_icon?: string;
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

const BLANK_ARTWORK_URL_PATTERN =
    /(^|\/)blank-icon\.(?:png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i;

function normalizeArtworkUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();

    if (!trimmed || BLANK_ARTWORK_URL_PATTERN.test(trimmed)) {
        return undefined;
    }

    return trimmed;
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
                    <mat-card
                        [class.grid-card--logo]="variant() === 'logo'"
                        (click)="itemClicked.emit(item)"
                    >
                        @let poster = resolvePoster(i);
                        <div class="card-thumbnail-container">
                            @if (type()) {
                                <div
                                    class="type-badge"
                                    [class.live]="type() === 'live'"
                                    [class.movie]="type() === 'vod'"
                                    [class.series]="type() === 'series'"
                                >
                                    {{ type() }}
                                </div>
                            }
                            @if (poster && !hasArtworkFailed(poster)) {
                                <img
                                    class="stream-icon"
                                    [src]="poster"
                                    (error)="onImageError($event, poster)"
                                    loading="lazy"
                                    alt="logo"
                                />
                            } @else if (
                                shouldRenderArtworkPlaceholder(poster)
                            ) {
                                <div
                                    class="stream-icon-placeholder"
                                    aria-hidden="true"
                                >
                                    <mat-icon>{{
                                        getPlaceholderIcon()
                                    }}</mat-icon>
                                </div>
                            } @else {
                                <img
                                    class="stream-icon"
                                    src="./assets/images/default-poster.png"
                                    loading="lazy"
                                    alt="logo"
                                />
                            }
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
        @if (showPaginator() && items().length > 0) {
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
    private readonly failedArtworkUrls = signal<ReadonlySet<string>>(new Set());

    readonly items = input<GridListItem[]>([]);
    readonly isLoading = input<boolean>(false);
    readonly showPaginator = input(true);
    readonly searchTerm = input<string>('');
    readonly itemClicked = output<GridListItem>();
    readonly pageChange = output<PageEvent>();

    readonly pageIndex = input<number>(0);
    readonly totalPages = input<number>(0);
    readonly limit = input<number>(25);
    readonly pageSizeOptions = input<number[]>([]);
    readonly variant = input<'poster' | 'logo'>('poster');
    readonly type = input<'vod' | 'series' | 'live' | string>('');
    protected readonly resolveRating = resolveGridRating;
    protected readonly resolvePoster = (
        item: GridListItem
    ): string | undefined =>
        normalizeArtworkUrl(item.poster_url) ??
        normalizeArtworkUrl(item.cover) ??
        normalizeArtworkUrl(item.stream_icon);
    protected readonly hasActiveSearch = computed(
        () => (this.searchTerm() ?? '').trim().length > 0
    );

    readonly skeletonRows = computed(() => {
        const preferredCount = this.limit() ?? 12;
        const count = Math.max(8, Math.min(18, preferredCount));
        return Array.from({ length: count }, (_, index) => index);
    });

    protected hasArtworkFailed(poster: string): boolean {
        return this.failedArtworkUrls().has(poster);
    }

    protected shouldRenderArtworkPlaceholder(
        poster: string | undefined
    ): boolean {
        return (
            this.usesArtworkPlaceholder() &&
            (!poster || this.hasArtworkFailed(poster))
        );
    }

    protected getPlaceholderIcon(): string {
        switch (this.type()) {
            case 'live':
                return 'live_tv';
            case 'series':
                return 'tv';
            default:
                return 'movie';
        }
    }

    protected onImageError(event: Event, poster: string): void {
        if (this.usesArtworkPlaceholder()) {
            this.failedArtworkUrls.update((failedUrls) => {
                const nextFailedUrls = new Set(failedUrls);
                nextFailedUrls.add(poster);

                return nextFailedUrls;
            });
            (event.target as HTMLImageElement | null)?.style.setProperty(
                'display',
                'none'
            );
            return;
        }

        (event.target as HTMLImageElement).src =
            './assets/images/default-poster.png';
    }

    private usesArtworkPlaceholder(): boolean {
        return this.variant() === 'logo' || this.type() === 'live';
    }
}
