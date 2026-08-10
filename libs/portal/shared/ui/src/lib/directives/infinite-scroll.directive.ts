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
    host: { '(scroll)': 'onScroll()' },
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
    readonly infiniteLoadMore = output<void>();

    private isWithinNearEndThreshold = false;
    private autoFillStalls = 0;
    private lastAutoFillScrollHeight: number | null = null;
    private pendingCheckFrame: number | null = null;

    constructor() {
        effect(() => {
            this.infiniteResetKey();
            untracked(() => {
                this.autoFillStalls = 0;
                this.lastAutoFillScrollHeight = null;
                this.isWithinNearEndThreshold = false;
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

        this.destroyRef.onDestroy(() => {
            resizeObserver?.disconnect();
            if (this.pendingCheckFrame !== null) {
                cancelAnimationFrame(this.pendingCheckFrame);
                this.pendingCheckFrame = null;
            }
        });
    }

    protected onScroll(): void {
        const isNearEnd = this.isNearEnd();

        if (isNearEnd && !this.isWithinNearEndThreshold && this.canLoad()) {
            this.infiniteLoadMore.emit();
        }

        this.isWithinNearEndThreshold = isNearEnd;
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
        this.infiniteLoadMore.emit();
    }

    private isNearEnd(): boolean {
        const { scrollHeight, scrollTop, clientHeight } =
            this.host.nativeElement;
        return scrollHeight - scrollTop - clientHeight <= NEAR_END_THRESHOLD_PX;
    }

    private canLoad(): boolean {
        return this.infiniteHasMore() && !this.infiniteAppending();
    }
}
