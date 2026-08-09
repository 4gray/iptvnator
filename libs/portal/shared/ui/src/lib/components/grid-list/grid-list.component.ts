import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';
import {
    getXtreamCatchupDays,
    isXtreamCatchupAvailable,
} from '@iptvnator/portal/shared/util';
import { SettingsStore } from '@iptvnator/services';
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
    tv_archive?: number | string | null;
    tv_archive_duration?: number | string | null;
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
                            @if (showCatchupBadge(i)) {
                                <div
                                    class="catchup-badge"
                                    data-test-id="grid-catchup-badge"
                                    [matTooltip]="
                                        catchupLabelKey(i)
                                            | translate: { days: catchupDays(i) }
                                    "
                                >
                                    <mat-icon>history</mat-icon>
                                    <!-- mat-icon is aria-hidden; expose the
                                         status as text for AT users -->
                                    <span class="visually-hidden">{{
                                        catchupLabelKey(i)
                                            | translate: { days: catchupDays(i) }
                                    }}</span>
                                </div>
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
                        <mat-card-actions>
                            <div class="title">
                                {{ channelTitle(i) }}
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
        @if (isAppending()) {
            <div class="grid-list__tail" aria-live="polite">
                <mat-spinner diameter="28" />
                <span>{{ 'PORTALS.GRID.LOADING_MORE' | translate }}</span>
            </div>
        } @else if (appendError()) {
            <div class="grid-list__tail grid-list__tail--error" role="alert">
                <span>{{ 'PORTALS.GRID.LOAD_MORE_FAILED' | translate }}</span>
                <button
                    type="button"
                    mat-stroked-button
                    (click)="retryLoadMore.emit()"
                >
                    {{ 'PORTALS.GRID.RETRY' | translate }}
                </button>
            </div>
        }`,
    styleUrl: './grid-list.component.scss',
    imports: [
        TranslatePipe,
        PlaylistErrorViewComponent,
        MatButtonModule,
        MatCardModule,
        MatIcon,
        MatProgressSpinnerModule,
        MatTooltip,
        ProgressCapsuleComponent,
        WatchedBadgeComponent,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridListComponent {
    private readonly failedArtworkUrls = signal<ReadonlySet<string>>(new Set());
    private readonly settingsStore = inject(SettingsStore);

    readonly items = input<GridListItem[]>([]);
    readonly isLoading = input<boolean>(false);
    /** True while an infinite-scroll append is in flight (tail spinner). */
    readonly isAppending = input<boolean>(false);
    /** True when the latest append failed; renders the retry tail. */
    readonly appendError = input<boolean>(false);
    readonly searchTerm = input<string>('');
    readonly itemClicked = output<GridListItem>();
    readonly retryLoadMore = output<void>();

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
    /** Prefix stripping applies to channel grids only, never VOD/series. */
    private readonly isLiveGrid = computed(() =>
        ['live', 'itv', 'radio'].includes(this.type())
    );
    protected readonly catchupDays = getXtreamCatchupDays;
    /** Catch-up badge is live-grid only; VOD/series rows never carry it. */
    protected showCatchupBadge(item: GridListItem): boolean {
        return this.isLiveGrid() && isXtreamCatchupAvailable(item);
    }
    protected catchupLabelKey(item: GridListItem): string {
        return getXtreamCatchupDays(item) > 0
            ? 'CHANNELS.CATCHUP_AVAILABLE_DAYS'
            : 'CHANNELS.CATCHUP_AVAILABLE';
    }
    protected readonly channelTitle = (item: GridListItem): string => {
        const raw = item.title ?? item.o_name ?? item.name ?? '';
        const stripped = applyChannelNameStrip(
            raw,
            this.isLiveGrid() && this.settingsStore.stripCountryPrefix?.()
        );
        return stripped || 'No name';
    };

    readonly skeletonRows = computed(() =>
        Array.from({ length: 12 }, (_, index) => index)
    );

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
