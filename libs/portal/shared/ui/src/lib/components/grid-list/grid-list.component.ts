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
    PortalWatchState,
    getXtreamCatchupDays,
    isXtreamCatchupAvailable,
} from '@iptvnator/portal/shared/util';
import { SettingsStore } from '@iptvnator/services';
import {
    ProgressCapsuleComponent,
    WatchedBadgeComponent,
} from '@iptvnator/ui/components';
import { CoverTitlesService } from '../../cover-titles/cover-titles.service';
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
    watchState?: PortalWatchState;
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
                    @let title = channelTitle(i);
                    <mat-card
                        [class.grid-card--logo]="variant() === 'logo'"
                        role="button"
                        tabindex="0"
                        [attr.aria-label]="title"
                        (click)="itemClicked.emit(item)"
                        (keydown.enter)="itemClicked.emit(item)"
                        (keydown.space)="onSpaceKey($event, item)"
                    >
                        @let poster = resolvePoster(i);
                        @let artworkMissing = !poster || hasArtworkFailed(poster);
                        <div class="card-thumbnail-container">
                            @if (!artworkMissing) {
                                <img
                                    class="stream-icon"
                                    [src]="poster"
                                    (error)="onImageError($event, poster)"
                                    loading="lazy"
                                    [alt]="title"
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
                                    [alt]="title"
                                />
                            }
                            @if (postersOnly()) {
                                <!-- Hover/focus caption for the posters-only
                                     wall; pinned open when the cover cannot
                                     identify the item on its own. -->
                                <div
                                    class="cover-title-overlay"
                                    [class.cover-title-overlay--pinned]="
                                        artworkMissing
                                    "
                                    aria-hidden="true"
                                >
                                    <span class="cover-title-overlay__text">{{
                                        title
                                    }}</span>
                                </div>
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
                                            | translate
                                                : { days: catchupDays(i) }
                                    "
                                >
                                    <mat-icon>history</mat-icon>
                                    <!-- mat-icon is aria-hidden; expose the
                                         status as text for AT users -->
                                    <span class="visually-hidden">{{
                                        catchupLabelKey(i)
                                            | translate
                                                : { days: catchupDays(i) }
                                    }}</span>
                                </div>
                            }
                            @if (i.watchState === 'watched') {
                                <app-watched-badge
                                    [isWatched]="true"
                                    icon="check_circle"
                                />
                            } @else if (
                                i.watchState === 'in-progress' && !i.progress
                            ) {
                                <!-- Started with no percent to draw (a series):
                                     the eye says "touched", the capsule above
                                     already says it for a movie. -->
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
                        @if (!postersOnly()) {
                            <mat-card-actions>
                                <div class="title">{{ title }}</div>
                            </mat-card-actions>
                        }
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
    host: { '[class.grid-list--posters-only]': 'postersOnly()' },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridListComponent {
    private readonly failedArtworkUrls = signal<ReadonlySet<string>>(new Set());
    private readonly settingsStore = inject(SettingsStore);
    private readonly coverTitles = inject(CoverTitlesService);

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
    /**
     * Posters-only wall (`Settings.showCoverTitles === false`) applies to
     * VOD/series covers only: channel logos are too often missing or
     * generic to identify a channel without its name. A grid filtered by
     * an in-section search keeps its titles too — those results are
     * identified by the name the user just typed.
     */
    protected readonly postersOnly = computed(
        () =>
            this.coverTitles.postersOnly() &&
            !this.isLiveGrid() &&
            this.variant() !== 'logo' &&
            !this.hasActiveSearch()
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

    /** Space activates like a click but must not scroll the grid. */
    protected onSpaceKey(event: Event, item: GridListItem): void {
        event.preventDefault();
        this.itemClicked.emit(item);
    }

    /**
     * A failed poster is remembered per URL so the template re-renders the
     * fallback branch (placeholder or default poster) — and the posters-only
     * overlay can pin the title, since a default poster identifies nothing.
     */
    protected onImageError(event: Event, poster: string): void {
        this.failedArtworkUrls.update((failedUrls) => {
            const nextFailedUrls = new Set(failedUrls);
            nextFailedUrls.add(poster);

            return nextFailedUrls;
        });
        (event.target as HTMLImageElement | null)?.style.setProperty(
            'display',
            'none'
        );
    }

    private usesArtworkPlaceholder(): boolean {
        return this.variant() === 'logo' || this.type() === 'live';
    }
}
