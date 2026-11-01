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
import { readProviderRating } from '@iptvnator/shared/interfaces';
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

/**
 * Card rating badge text. Provider stand-ins (`"N/A"`, `"-"`) and an unrated
 * zero read as no rating — see `readProviderRating` — so the badge is hidden
 * and {@link resolveGridRating} can reach the generic `rating` behind them.
 */
export function formatGridRating(value: unknown): string | undefined {
    const text = readProviderRating(value);
    if (text === undefined) {
        return undefined;
    }

    const numericRating = Number.parseFloat(text);
    return Number.isFinite(numericRating) ? numericRating.toFixed(1) : text;
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
    templateUrl: './grid-list.component.html',
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

    readonly refinementActive = input(false);
    readonly sourceHasMore = input(false);
    readonly loadMorePaused = input(false);
    readonly continueLoading = output<void>();
    readonly clearRefinement = output<void>();
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
    protected readonly ratingLabelKey = (item: GridListItem): string =>
        formatGridRating(item.rating_imdb)
            ? 'XTREAM.IMDB_RATING'
            : 'XTREAM.RATING';
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
        // Empty: the template shows the translated "Untitled" label.
        return stripped;
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
