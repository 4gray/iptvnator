import {
    DestroyRef,
    Directive,
    ElementRef,
    effect,
    inject,
    input,
    output,
    untracked,
} from '@angular/core';

/**
 * Matches the `nearEnd` threshold already used by `SearchLayoutComponent` so
 * both infinite-scroll surfaces trigger at the same distance from the bottom.
 */
const NEAR_END_THRESHOLD_PX = 240;

/**
 * How many consecutive self-initiated loads may complete WITHOUT growing the
 * container before the auto-fill stops. Progress (a growing `scrollHeight`)
 * always resets the count, so a huge viewport keeps filling until it actually
 * overflows — a fixed load budget would strand the remaining items with no
 * scrollbar to reach them. Only a degenerate source that reports more items
 * but renders nothing trips this guard.
 */
const MAX_AUTO_FILL_STALLS = 3;

/**
 * Infinite scroll for a scrollable list container.
 *
 * Two triggers emit `infiniteLoadMore`:
 * - edge-triggered near-end detection while the user scrolls (fires once per
 *   crossing into the threshold, mirroring `SearchLayoutComponent`);
 * - an auto-fill check that measures the container instead of guessing item
 *   sizes: whenever the rendered list changes (or the container resizes) and
 *   the bottom is still within the threshold, another load is requested. This
 *   fills viewports taller than one provider page without any card-size math.
 *
 * The host element must be the scroll container itself (`overflow-y: auto`).
 */
@Directive({
    selector: '[appInfiniteScroll]',
    standalone: true,
})
export class InfiniteScrollDirective {
    private readonly host = inject(ElementRef<HTMLElement>);
    private readonly destroyRef = inject(DestroyRef);

    /** Whether the data source can supply more items. */
    readonly infiniteHasMore = input(false);
    /** True while an asynchronous append is in flight; suppresses triggers. */
    readonly infiniteAppending = input(false);
    /** Rendered item count; a change schedules an overflow re-check. */
    readonly infiniteItemCount = input(0);
    /** Identity of the rendered list; a change resets the auto-fill budget. */
    readonly infiniteResetKey = input('');
    /**
     * Distance from the bottom, in px, at which the next page is requested. A
     * poster grid asks two rows ahead, so a key press that arrives while the
     * deferred append renders still has a row to move to.
     */
    readonly infiniteThresholdPx = input(NEAR_END_THRESHOLD_PX);
    readonly infiniteLoadMore = output<void>();

    private isWithinNearEndThreshold = false;
    private autoFillStalls = 0;
    private lastAutoFillScrollHeight: number | null = null;
    private pendingCheckFrame: number | null = null;
    private pendingLoadMore: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        effect(() => {
            this.infiniteResetKey();
            untracked(() => {
                this.autoFillStalls = 0;
                this.lastAutoFillScrollHeight = null;
                this.isWithinNearEndThreshold = false;
                this.cancelPendingLoadMore();
                this.scheduleFillCheck();
            });
        });

        effect(() => {
            this.infiniteItemCount();
            this.infiniteHasMore();
            const appending = this.infiniteAppending();
            untracked(() => {
                if (!appending) {
                    this.scheduleFillCheck();
                }
            });
        });

        const resizeObserver =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(() => this.scheduleFillCheck());
        resizeObserver?.observe(this.host.nativeElement);

        // Registered outside Angular's event binding on purpose: in zoneless
        // mode a bound listener marks the view dirty and schedules a full
        // change-detection pass on every scroll frame, though only an emitted
        // load needs one (the consumer's output listener schedules it).
        const host = this.host.nativeElement;
        const onScroll = () => this.onScroll();
        host.addEventListener('scroll', onScroll, { passive: true });

        this.destroyRef.onDestroy(() => {
            host.removeEventListener('scroll', onScroll);
            resizeObserver?.disconnect();
            this.cancelPendingLoadMore();
            if (this.pendingCheckFrame !== null) {
                cancelAnimationFrame(this.pendingCheckFrame);
                this.pendingCheckFrame = null;
            }
        });
    }

    private onScroll(): void {
        const isNearEnd = this.isNearEnd();

        if (isNearEnd && !this.isWithinNearEndThreshold && this.canLoad()) {
            this.scheduleLoadMore();
        }

        this.isWithinNearEndThreshold = isNearEnd;
    }

    /**
     * Emits after the frame that carries the scroll has painted: a consumer
     * whose append is synchronous (the Xtream window) would otherwise render
     * a whole page of cards in the frame of the key press that crossed the
     * threshold.
     */
    private scheduleLoadMore(): void {
        if (this.pendingLoadMore !== null) {
            return;
        }
        this.pendingLoadMore = setTimeout(() => {
            this.pendingLoadMore = null;
            if (this.canLoad()) {
                this.infiniteLoadMore.emit();
            }
        }, 0);
    }

    private cancelPendingLoadMore(): void {
        if (this.pendingLoadMore !== null) {
            clearTimeout(this.pendingLoadMore);
            this.pendingLoadMore = null;
        }
    }

    private scheduleFillCheck(): void {
        if (this.pendingCheckFrame !== null) {
            return;
        }

        this.pendingCheckFrame = requestAnimationFrame(() => {
            this.pendingCheckFrame = null;
            this.runFillCheck();
        });
    }

    private runFillCheck(): void {
        // Refresh the edge latch from the measured state: appended content can
        // move the bottom out of the threshold without any scroll event, and a
        // stale latch would swallow the next genuine crossing (End key,
        // scrollbar drag straight to the bottom).
        const isNearEnd = this.isNearEnd();
        this.isWithinNearEndThreshold = isNearEnd;

        if (!isNearEnd || !this.canLoad()) {
            return;
        }

        // Terminate on lack of progress, not on a load count: keep requesting
        // while loads grow the container (until it overflows and real scroll
        // events take over), stop once they demonstrably stop growing it.
        const { scrollHeight } = this.host.nativeElement;
        if (
            this.lastAutoFillScrollHeight !== null &&
            scrollHeight <= this.lastAutoFillScrollHeight
        ) {
            this.autoFillStalls += 1;
        } else {
            this.autoFillStalls = 0;
        }

        if (this.autoFillStalls >= MAX_AUTO_FILL_STALLS) {
            return;
        }

        this.lastAutoFillScrollHeight = scrollHeight;
        // This load also answers a scroll that crossed the threshold meanwhile.
        this.cancelPendingLoadMore();
        this.infiniteLoadMore.emit();
    }

    private isNearEnd(): boolean {
        const { scrollHeight, scrollTop, clientHeight } =
            this.host.nativeElement;
        return (
            scrollHeight - scrollTop - clientHeight <= this.infiniteThresholdPx()
        );
    }

    private canLoad(): boolean {
        return this.infiniteHasMore() && !this.infiniteAppending();
    }
}
