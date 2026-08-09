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
 * Upper bound on loads the directive fires on its own (without a user scroll)
 * per `infiniteResetKey`. Guards against a provider whose reported totals never
 * converge — after the cap, loading continues only from real scroll events.
 */
const MAX_AUTO_FILL_LOADS = 10;

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
    private autoFillLoads = 0;
    private pendingCheckFrame: number | null = null;

    constructor() {
        effect(() => {
            this.infiniteResetKey();
            untracked(() => {
                this.autoFillLoads = 0;
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

        if (
            !isNearEnd ||
            !this.canLoad() ||
            this.autoFillLoads >= MAX_AUTO_FILL_LOADS
        ) {
            return;
        }

        this.autoFillLoads += 1;
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
