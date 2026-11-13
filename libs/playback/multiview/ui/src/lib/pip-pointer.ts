/** Movement below this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4;

export interface PipPointerHandlers {
    readonly move: (dx: number, dy: number) => void;
    /** `moved` is false for a plain click. */
    readonly end: (dx: number, dy: number, moved: boolean) => void;
}

/**
 * Follows one pointer from pointerdown to release, on the element that got
 * the pointerdown (pointer capture keeps the events coming outside it).
 */
export function trackPointer(
    event: PointerEvent,
    handlers: PipPointerHandlers
): void {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    target.setPointerCapture?.(event.pointerId);

    const onMove = (next: PointerEvent): void => {
        const dx = next.clientX - startX;
        const dy = next.clientY - startY;
        moved ||= Math.hypot(dx, dy) >= DRAG_THRESHOLD;
        if (moved) handlers.move(dx, dy);
    };
    const onEnd = (next: PointerEvent): void => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onEnd);
        target.removeEventListener('pointercancel', onEnd);
        target.releasePointerCapture?.(next.pointerId);
        handlers.end(next.clientX - startX, next.clientY - startY, moved);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onEnd);
    target.addEventListener('pointercancel', onEnd);
}
