import {
    afterRenderEffect,
    ChangeDetectorRef,
    computed,
    DestroyRef,
    DOCUMENT,
    ElementRef,
    inject,
    Signal,
    signal,
} from '@angular/core';
import {
    computeGridWindow,
    GRID_WINDOW_INITIAL_ITEMS,
    GridGeometry,
    isGridWindowingEnabled,
    measureGridGeometry,
    sameGridGeometry,
    sameGridWindow,
} from './grid-window';

interface KeyedItem {
    id?: unknown;
    stream_id?: unknown;
    series_id?: unknown;
    xtream_id?: unknown;
}

export interface GridWindowView<T> {
    /** True in the TV shell; fixed for the grid's lifetime. */
    readonly enabled: boolean;
    /** The items to render: all of them when windowing is off. */
    readonly rendered: Signal<readonly T[]>;
    /** Spacer heights for the grid's padding; null when windowing is off. */
    readonly topPx: Signal<number | null>;
    readonly bottomPx: Signal<number | null>;
    /** `@for` track key: `$index` when off, the item's identity when on. */
    trackKey(index: number, item: T): unknown;
}

/**
 * Wires {@link computeGridWindow} to the grid host (the scroll container):
 * geometry is measured after each render and on resize, the scroll offset on
 * every scroll event. Must be called in an injection context.
 */
export function createGridWindow<T extends object>(
    items: Signal<readonly T[]>,
    suspended: Signal<boolean>
): GridWindowView<T> {
    const enabled = isGridWindowingEnabled(inject(DOCUMENT));
    if (!enabled) {
        const off = computed<number | null>(() => null);
        return {
            enabled,
            rendered: items,
            topPx: off,
            bottomPx: off,
            trackKey: (index) => index,
        };
    }

    const host: HTMLElement = inject(ElementRef).nativeElement;
    const geometry = signal<GridGeometry | null>(null, {
        equal: sameGridGeometry,
    });
    const scrollTop = signal(0);
    const range = computed(
        () => {
            const measured = geometry();
            return measured
                ? computeGridWindow(items().length, measured, scrollTop())
                : null;
        },
        { equal: sameGridWindow }
    );
    // Absolute position of each rendered item, for items without an id: a live
    // card keeps the key it was rendered with, and a re-mapped object (a
    // consumer rebuilding its items on each change) at the same position
    // gets the same key, so neither a window shift nor an update re-creates it.
    const positions = new WeakMap<object, number>();
    const rendered = computed(() => {
        const window = range();
        const start = window?.start ?? 0;
        const slice = window
            ? items().slice(window.start, window.end)
            : items().slice(0, GRID_WINDOW_INITIAL_ITEMS);
        slice.forEach((item, i) => positions.set(item, start + i));
        return slice;
    });

    let observedGrid: HTMLElement | null = null;
    const measure = (): void => {
        const grid = host.querySelector<HTMLElement>(
            ':scope > .grid-list__grid'
        );
        if (!grid || suspended()) {
            return;
        }
        if (grid !== observedGrid) {
            observedGrid = grid;
            resizeObserver?.observe(grid);
        }
        const measured = measureGridGeometry(host, grid);
        if (measured) {
            scrollTop.set(host.scrollTop);
            geometry.set(measured);
        }
    };
    const onScroll = (): void => scrollTop.set(host.scrollTop);
    // A held D-pad key moves focus (and scrolls) faster than frames render
    // on a slow TV, and the scroll event only arrives with the next frame.
    // Before the remote layer handles the next key on the grid, bring the
    // window up to the current offset so the next row is already there.
    const cdr = inject(ChangeDetectorRef);
    const beforeKey = (event: Event): void => {
        if (!host.contains(event.target as Node | null)) {
            return;
        }
        const previous = range();
        scrollTop.set(host.scrollTop);
        if (!sameGridWindow(previous, range())) {
            cdr.detectChanges();
        }
    };
    const view = host.ownerDocument.defaultView;
    const resizeObserver =
        typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(() => measure());
    resizeObserver?.observe(host);
    host.addEventListener('scroll', onScroll, { passive: true });
    view?.addEventListener('keydown', beforeKey, { capture: true });
    inject(DestroyRef).onDestroy(() => {
        resizeObserver?.disconnect();
        host.removeEventListener('scroll', onScroll);
        view?.removeEventListener('keydown', beforeKey, { capture: true });
    });

    // Re-measure once the new slice is in the DOM: the first cards give the
    // geometry, later ones confirm it (a resize or font swap changes it).
    afterRenderEffect({
        read: () => {
            rendered();
            measure();
        },
    });

    const spacer = (pick: 'topPx' | 'bottomPx') =>
        computed(() => (suspended() ? null : (range()?.[pick] ?? 0)));
    return {
        enabled,
        rendered,
        topPx: spacer('topPx'),
        bottomPx: spacer('bottomPx'),
        trackKey: (index, item) => {
            const keyed = item as KeyedItem;
            return (
                keyed.id ??
                keyed.stream_id ??
                keyed.series_id ??
                keyed.xtream_id ??
                `#${positions.get(item) ?? index}`
            );
        },
    };
}
