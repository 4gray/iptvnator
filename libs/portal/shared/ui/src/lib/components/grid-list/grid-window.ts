/**
 * Row windowing for the poster grid: only the rows around the viewport are
 * rendered, and two spacers (the grid's top and bottom padding) stand in for
 * the rows above and below, so the scroll container keeps the exact
 * `scrollHeight` of the full grid. The store's growing `visibleCount`, the
 * infinite-scroll near-end check and the saved `scrollTop` restore keep
 * working on that height unchanged; only the DOM stops growing.
 *
 * Active in the TV shell only for now (its `tv.js` puts the `tv-shell` class
 * on `<html>` before the app boots), where every D-pad press measures every
 * rendered card. Kill switch: `localStorage['grid-list:windowing'] = 'off'`.
 */

/** Rows rendered beyond each edge of the viewport; the rest are spacers. */
export const GRID_WINDOW_OVERSCAN_ROWS = 3;
/** Cards rendered before the first measurement (one screen, two rows). */
export const GRID_WINDOW_INITIAL_ITEMS = 60;
/** Class the TV shell sets on `<html>`; windowing is gated on it. */
export const GRID_WINDOW_SHELL_CLASS = 'tv-shell';
export const GRID_WINDOW_KILL_SWITCH_KEY = 'grid-list:windowing';

export interface GridGeometry {
    /** Cards per row. */
    readonly columns: number;
    /** Distance between the tops of two consecutive rows (card + row gap). */
    readonly rowPitch: number;
    /** Top of the grid's border box within the scroll content. */
    readonly gridOffset: number;
    /** Visible height of the scroll container. */
    readonly viewportHeight: number;
}

export interface GridWindow {
    /** First rendered item (inclusive), always the start of a row. */
    readonly start: number;
    /** Last rendered item (exclusive). */
    readonly end: number;
    /** Height of the rows above the window. */
    readonly topPx: number;
    /** Height of the rows below the window. */
    readonly bottomPx: number;
}

export function isGridWindowingEnabled(doc: Document | null): boolean {
    if (!doc?.documentElement?.classList.contains(GRID_WINDOW_SHELL_CLASS)) {
        return false;
    }
    try {
        const storage = doc.defaultView?.localStorage;
        return storage?.getItem(GRID_WINDOW_KILL_SWITCH_KEY) !== 'off';
    } catch {
        return true;
    }
}

/**
 * The rows intersecting the viewport plus `overscanRows` on each side. Never
 * empty while there are items: a stale offset past the end (the list just
 * shrank) still renders the last rows until the browser clamps the scroll.
 */
export function computeGridWindow(
    itemCount: number,
    geometry: GridGeometry,
    scrollTop: number,
    overscanRows = GRID_WINDOW_OVERSCAN_ROWS
): GridWindow {
    const { columns, rowPitch, gridOffset, viewportHeight } = geometry;
    if (itemCount <= 0 || !(columns >= 1) || !(rowPitch > 0)) {
        return { start: 0, end: Math.max(0, itemCount), topPx: 0, bottomPx: 0 };
    }

    const totalRows = Math.ceil(itemCount / columns);
    const top = Math.max(0, scrollTop - gridOffset);
    const bottom = top + Math.max(0, viewportHeight);
    const firstVisibleRow = Math.min(totalRows - 1, Math.floor(top / rowPitch));
    const lastVisibleRow = Math.min(
        totalRows - 1,
        Math.floor(bottom / rowPitch)
    );
    const firstRow = Math.max(0, firstVisibleRow - overscanRows);
    const endRow = Math.min(totalRows, lastVisibleRow + 1 + overscanRows);

    return {
        start: firstRow * columns,
        end: Math.min(itemCount, endRow * columns),
        topPx: firstRow * rowPitch,
        bottomPx: (totalRows - endRow) * rowPitch,
    };
}

export function sameGridWindow(
    a: GridWindow | null,
    b: GridWindow | null
): boolean {
    return (
        a === b ||
        (!!a &&
            !!b &&
            a.start === b.start &&
            a.end === b.end &&
            a.topPx === b.topPx &&
            a.bottomPx === b.bottomPx)
    );
}

export function sameGridGeometry(
    a: GridGeometry | null,
    b: GridGeometry | null
): boolean {
    return (
        a === b ||
        (!!a &&
            !!b &&
            a.columns === b.columns &&
            a.rowPitch === b.rowPitch &&
            a.gridOffset === b.gridOffset &&
            a.viewportHeight === b.viewportHeight)
    );
}

/**
 * Reads the grid's row geometry from its rendered cards, or null while it
 * has none to measure (loading, empty, detached or hidden). A host that is
 * not a scroll container gets an unbounded viewport: everything renders.
 */
export function measureGridGeometry(
    host: HTMLElement,
    grid: HTMLElement
): GridGeometry | null {
    const view = host.ownerDocument.defaultView;
    const cards = grid.querySelectorAll<HTMLElement>(':scope > mat-card');
    if (!view || cards.length === 0) {
        return null;
    }

    const first = cards[0].getBoundingClientRect();
    if (!(first.height > 0)) {
        // display:none ancestor: no boxes, but the styles still resolve.
        return null;
    }
    const gridStyle = view.getComputedStyle(grid);
    const firstTop = first.top;
    const columns = countColumns(gridStyle.gridTemplateColumns, cards);
    const rowPitch =
        cards.length > columns
            ? cards[columns].getBoundingClientRect().top - firstTop
            : cards[0].getBoundingClientRect().height +
              (Number.parseFloat(gridStyle.rowGap) || 0);
    if (!(rowPitch > 0)) {
        return null;
    }

    const hostTop = host.getBoundingClientRect().top + host.clientTop;
    const scrolls = /(auto|scroll|overlay)/.test(
        view.getComputedStyle(host).overflowY
    );
    return {
        columns,
        rowPitch,
        gridOffset: grid.getBoundingClientRect().top - hostTop + host.scrollTop,
        viewportHeight: scrolls ? host.clientHeight : Number.POSITIVE_INFINITY,
    };
}

/**
 * The resolved `grid-template-columns` of a laid-out grid lists one length
 * per track; otherwise count the cards sharing the first card's row.
 */
function countColumns(
    templateColumns: string,
    cards: NodeListOf<HTMLElement>
): number {
    const tracks = templateColumns.trim().split(/\s+/);
    if (
        tracks.length > 0 &&
        tracks.every((track) => /^[\d.]+px$/.test(track))
    ) {
        return tracks.length;
    }

    const firstTop = cards[0].getBoundingClientRect().top;
    let columns = 1;
    while (
        columns < cards.length &&
        Math.abs(cards[columns].getBoundingClientRect().top - firstTop) < 1
    ) {
        columns += 1;
    }
    return columns;
}
