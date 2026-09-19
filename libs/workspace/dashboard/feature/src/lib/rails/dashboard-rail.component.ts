import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
    viewChild,
    viewChildren,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import { applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';

export interface DashboardRailAction {
    id: string;
    labelKey: string;
    icon: string;
    destructive?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
}

export interface DashboardRailCard {
    id: string;
    title: string;
    subtitle?: string;
    imageUrl?: string;
    icon: string;
    contentType?: 'live' | 'movie' | 'series';
    link: string[];
    queryParams?: Record<string, string>;
    state?: Record<string, unknown>;
    actions?: DashboardRailAction[];
    epgLookupKey?: string;
    /**
     * Key of the portal (Xtream/Stalker) EPG answer for a live card, asked
     * for lazily once the card is on screen — see
     * `DashboardPortalLiveEpgPresenter`. Unset for M3U cards.
     */
    liveEpgSourceKey?: string | null;
    /**
     * `'pending'` while the card's first portal answer is on its way: the
     * 'channel' layout shows a placeholder instead of the subtitle. A later
     * refresh keeps the previous answer on screen, so it never flashes.
     */
    nowPlayingState?: 'pending' | null;

    /**
     * Optional EPG enrichment shown by the 'channel' rail layout. Populated
     * asynchronously after the card list is computed — when null/undefined
     * the channel card renders without the program subtitle/progress.
     */
    nowPlayingTitle?: string | null;
    /** Localised time range like "12:15 – 13:40". */
    nowPlayingTimeRange?: string | null;
    /** 0–100, % through the current program. */
    nowPlayingProgress?: number | null;

    /**
     * 0–100 watched, attached for movies/series with a resume position so
     * the cover layout can render a thin "watched up to here" bar at the
     * bottom of the poster. Live cards and content without a tracked
     * position leave this unset.
     */
    watchProgress?: number | null;

    /**
     * Localised "S{n} · E{n}" badge for series with a tracked episode
     * position. Renders as a small chip next to the card subtitle so the
     * user can see which episode they were on without opening the show.
     */
    episodeBadge?: string | null;

    /**
     * Subscription-expiry warning for portal source cards: a quiet amber
     * chip when the account expires soon, an error-toned one once it has.
     * The chip is passive — account details stay behind ⋮ → Account info.
     */
    expiryBadge?: { kind: 'expiring' | 'expired'; label: string } | null;
}

/**
 * Visual layout of the rail's cards.
 *  - 'cover': portrait poster (Netflix-style), used for movies/series and
 *    recently-added catalog items.
 *  - 'channel': compact horizontal info row (logo + channel name + current
 *    program + progress), used for live TV. TV station logos are small, so
 *    inflating them into 2:3 posters wastes space the cards never use.
 */
export type DashboardRailLayout = 'cover' | 'channel';

export interface DashboardRailActionSelection {
    action: DashboardRailAction;
    card: DashboardRailCard;
}

@Component({
    selector: 'lib-dashboard-rail',
    imports: [
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        RouterLink,
        TranslatePipe,
    ],
    templateUrl: './dashboard-rail.component.html',
    styleUrl: './dashboard-rail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardRailComponent implements AfterViewInit, OnDestroy {
    private readonly settingsStore = inject(SettingsStore);

    readonly label = input.required<string>();
    readonly items = input.required<DashboardRailCard[]>();
    readonly seeAllLink = input<string[] | null>(null);
    readonly seeAllState = input<Record<string, unknown> | null>(null);
    readonly aspectRatio = input<string>('2 / 3');
    readonly layout = input<DashboardRailLayout>('cover');
    readonly testId = input<string | null>(null);
    readonly actionSelected = output<DashboardRailActionSelection>();
    /**
     * The cards inside (or just beyond, see `rootMargin`) the rail's
     * viewport, in item order; emitted whenever that set changes. Lets the
     * host ask for per-card data — portal EPG — only for cards the user can
     * see. Environments without `IntersectionObserver` report every card.
     */
    readonly visibleCardsChanged = output<DashboardRailCard[]>();
    /**
     * True total in the underlying dataset. Shown as a count badge next to
     * the rail label. Falls back to `items().length` when not supplied.
     */
    readonly totalCount = input<number | null>(null);

    private readonly track =
        viewChild.required<ElementRef<HTMLDivElement>>('track');
    private readonly cardElements =
        viewChildren<ElementRef<HTMLElement>>('cardEl');

    readonly canScrollLeft = signal(false);
    readonly canScrollRight = signal(false);
    readonly failedImages = signal<Record<string, true>>({});
    private readonly viewReady = signal(false);

    private resizeObserver?: ResizeObserver;
    private intersectionObserver?: IntersectionObserver;
    private readonly visibleCardIds = new Set<string>();
    private lastVisibleSignature: string | null = null;
    private resetFrameId: number | null = null;
    private settleFrameId: number | null = null;

    constructor() {
        effect(() => {
            this.items();
            if (!this.viewReady()) return;
            this.scheduleResetToStart();
        });
        // The rendered card set changed: watch the new elements. Reading
        // `items()` too keeps an id-only change (same elements, new cards)
        // from leaving a stale visible set behind.
        effect(() => {
            const elements = this.cardElements();
            this.items();
            untracked(() => this.observeCards(elements));
        });
    }

    ngAfterViewInit(): void {
        this.viewReady.set(true);
        this.updateScrollState();
        this.resizeObserver = new ResizeObserver(() =>
            this.updateScrollState()
        );
        this.resizeObserver.observe(this.track().nativeElement);
    }

    ngOnDestroy(): void {
        this.resizeObserver?.disconnect();
        this.intersectionObserver?.disconnect();
        this.cancelPendingReset();
    }

    private observeCards(elements: readonly ElementRef<HTMLElement>[]): void {
        const renderedIds = new Set(
            elements.map((element) => element.nativeElement.dataset['cardId'])
        );
        for (const id of [...this.visibleCardIds]) {
            if (!renderedIds.has(id)) this.visibleCardIds.delete(id);
        }

        if (typeof IntersectionObserver === 'undefined') {
            for (const id of renderedIds) {
                if (id) this.visibleCardIds.add(id);
            }
            this.emitVisibleCards();
            return;
        }

        this.intersectionObserver?.disconnect();
        // Cards that left the list are reported gone at once; the observer's
        // initial notifications then settle the cards that are still here.
        this.emitVisibleCards();
        if (elements.length === 0) {
            return;
        }
        // Lazily created: the first non-empty card list means the track
        // exists. A margin of roughly one card lets the next card's answer
        // arrive before the user scrolls to it. Observing fires an initial
        // notification for every target, which settles the visible set.
        this.intersectionObserver ??= new IntersectionObserver(
            (entries) => this.onCardsIntersect(entries),
            {
                root: this.track().nativeElement,
                rootMargin: '0px 160px 0px 160px',
                threshold: 0,
            }
        );
        for (const element of elements) {
            this.intersectionObserver.observe(element.nativeElement);
        }
    }

    private onCardsIntersect(entries: IntersectionObserverEntry[]): void {
        for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset['cardId'];
            if (!id) continue;
            if (entry.isIntersecting) {
                this.visibleCardIds.add(id);
            } else {
                this.visibleCardIds.delete(id);
            }
        }
        this.emitVisibleCards();
    }

    private emitVisibleCards(): void {
        const visible = this.items().filter((card) =>
            this.visibleCardIds.has(card.id)
        );
        const signature = visible.map((card) => card.id).join(' ');
        if (signature === this.lastVisibleSignature) return;
        this.lastVisibleSignature = signature;
        this.visibleCardsChanged.emit(visible);
    }

    onScroll(): void {
        this.updateScrollState();
    }

    scrollBy(direction: 1 | -1): void {
        const el = this.track().nativeElement;
        el.scrollBy({
            left: direction * el.clientWidth * 0.85,
            behavior: 'smooth',
        });
    }

    markFailed(id: string): void {
        this.failedImages.update((state) =>
            state[id] ? state : { ...state, [id]: true }
        );
    }

    stopActionEvent(event: Event): void {
        event.stopPropagation();
    }

    /** Prefix stripping applies to live-channel cards only, never VOD/series. */
    protected cardTitle(card: DashboardRailCard): string {
        return applyChannelNameStrip(
            card.title,
            card.contentType === 'live' &&
                this.settingsStore.stripCountryPrefix?.()
        );
    }

    selectAction(
        card: DashboardRailCard,
        action: DashboardRailAction,
        event: Event
    ): void {
        event.stopPropagation();
        this.actionSelected.emit({ card, action });
    }

    private updateScrollState(): void {
        const el = this.track().nativeElement;
        this.canScrollLeft.set(el.scrollLeft > 4);
        this.canScrollRight.set(
            el.scrollLeft + el.clientWidth < el.scrollWidth - 4
        );
    }

    private scheduleResetToStart(): void {
        this.cancelPendingReset();
        this.resetFrameId = requestAnimationFrame(() => {
            this.resetFrameId = null;
            this.settleFrameId = requestAnimationFrame(() => {
                this.settleFrameId = null;
                const el = this.track().nativeElement;
                el.scrollTo({ left: 0, behavior: 'auto' });
                this.updateScrollState();
            });
        });
    }

    private cancelPendingReset(): void {
        if (this.resetFrameId !== null) {
            cancelAnimationFrame(this.resetFrameId);
            this.resetFrameId = null;
        }
        if (this.settleFrameId !== null) {
            cancelAnimationFrame(this.settleFrameId);
            this.settleFrameId = null;
        }
    }
}
