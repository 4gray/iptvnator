import type { Rectangle } from 'electron';

/**
 * Minimum width/height (in pixels) the saved window bounds must overlap a
 * connected display's work area by before the bounds are trusted. A sliver
 * of overlap would still leave the title bar unreachable to drag back.
 */
const MIN_VISIBLE_OVERLAP = 100;

function intersectionSize(
    a: Rectangle,
    b: Rectangle
): { width: number; height: number } {
    const width = Math.max(
        0,
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    );
    const height = Math.max(
        0,
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    );
    return { width, height };
}

/**
 * Drops saved window bounds if the title bar is off-screen or too little of
 * the window overlaps the display.
 *
 * `BrowserWindow`'s constructor positions the window at whatever `x`/`y` was
 * last persisted, even past every current display's work area: unplugging
 * the monitor a window was last shown on reopens it off-screen, with no way
 * back short of resetting the stored config. Returning `undefined` here
 * falls back to the caller's existing "no saved bounds" path, which centers
 * the window on the primary display instead.
 */
export function resolveVisibleWindowBounds(
    savedBounds: Rectangle | undefined,
    displayWorkAreas: Rectangle[]
): Rectangle | undefined {
    if (!savedBounds) {
        return undefined;
    }

    const isVisible = displayWorkAreas.some((workArea) => {
        const overlap = intersectionSize(savedBounds, workArea);
        return (
            savedBounds.y >= workArea.y &&
            overlap.width >= MIN_VISIBLE_OVERLAP &&
            overlap.height >= MIN_VISIBLE_OVERLAP
        );
    });

    return isVisible ? savedBounds : undefined;
}
