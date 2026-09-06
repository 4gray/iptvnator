/**
 * Pure scroll geometry for the guide viewport, extracted from the shell so the
 * component stays small and the maths can be unit-tested without a DOM.
 */

/** Horizontal padding kept to the left of a revealed programme block. */
const REVEAL_PADDING_PX = 40;

/** Puts the now-line a third into the visible lane, never past the start. */
export function guideNowScrollLeft(
    clientWidth: number,
    nowLeftPx: number,
    channelColumnPx: number
): number {
    const visibleTrack = Math.max(0, clientWidth - channelColumnPx);
    return Math.max(0, nowLeftPx - visibleTrack / 3);
}

/** True when the row is (partly) outside the vertical viewport. */
export function guideRowNeedsReveal(
    rowIndex: number,
    rowHeightPx: number,
    scrollTop: number,
    clientHeight: number
): boolean {
    const rowTop = rowIndex * rowHeightPx;
    return (
        rowTop < scrollTop || rowTop + rowHeightPx > scrollTop + clientHeight
    );
}

/**
 * Target scrollLeft that brings a block into the lane, or `null` when it is
 * already fully visible.
 */
export function guideBlockRevealScrollLeft(
    block: { readonly leftPx: number; readonly widthPx: number },
    scrollLeft: number,
    clientWidth: number,
    channelColumnPx: number
): number | null {
    const visibleWidth = Math.max(0, clientWidth - channelColumnPx);
    const fitsLeft = block.leftPx >= scrollLeft;
    const fitsRight = block.leftPx + block.widthPx <= scrollLeft + visibleWidth;
    if (fitsLeft && fitsRight) {
        return null;
    }
    return Math.max(0, block.leftPx - REVEAL_PADDING_PX);
}

/**
 * `Element.scrollTo` is not implemented everywhere the guide renders (jsdom in
 * unit tests), so fall back to assigning `scrollLeft` directly.
 */
export function scrollElementLeft(
    element: HTMLElement,
    left: number,
    animate: boolean
): void {
    if (typeof element.scrollTo === 'function') {
        element.scrollTo({ left, behavior: animate ? 'smooth' : 'auto' });
        return;
    }
    element.scrollLeft = left;
}
