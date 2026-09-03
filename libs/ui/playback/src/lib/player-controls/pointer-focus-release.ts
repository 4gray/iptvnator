/**
 * Controls whose pointer-originated focus is released once the click that
 * produced it completes. Text entry is deliberately absent: a click into a
 * field must not end typing. Neither the shared controls bar nor the vendor
 * chrome holds one today.
 */
export const POINTER_FOCUS_RELEASE_SELECTOR =
    'button, input[type="range"], [role="slider"]';

export interface BlurFocusedControlOptions {
    /** Controls eligible for release; defaults to the shared selector. */
    selector?: string;
    /**
     * Subtrees whose focus is left alone even when the control matches, for
     * chrome that manages focus itself (a popup menu that closes on blur).
     */
    exempt?: string;
}

/**
 * What a click's own `pointerType` says about its origin: `true` for a
 * pointer (mouse, touch, pen); `false` for keyboard activation or script,
 * since current engines dispatch Enter/Space on a focused button and
 * `element.click()` as a PointerEvent with an empty `pointerType`; `null`
 * for a legacy MouseEvent click that carries no pointer type at all, which
 * the caller must attribute some other way or leave alone.
 */
export function clickPointerOrigin(event: MouseEvent): boolean | null {
    const pointerType = (event as Partial<PointerEvent>).pointerType;
    return typeof pointerType === 'string' ? pointerType !== '' : null;
}

/**
 * Blur the focused control inside `root` when it is eligible. Chromium
 * focuses a clicked `<button>`, and a focused control captures the keyboard:
 * Space and Enter activate it again and the playback shortcuts yield to it.
 * Focus a pointer click left behind was never the keyboard's, so it is
 * dropped once the click completes; Chromium keeps its sequential focus
 * navigation starting point at the blurred control, so a later Tab
 * continues from it exactly as if it were still focused. Returns whether
 * focus was released.
 */
export function blurFocusedControl(
    root: HTMLElement,
    options: BlurFocusedControlOptions = {}
): boolean {
    const active = root.ownerDocument.activeElement;
    if (
        !(active instanceof HTMLElement) ||
        !root.contains(active) ||
        !active.matches(options.selector ?? POINTER_FOCUS_RELEASE_SELECTOR) ||
        (options.exempt !== undefined &&
            active.closest(options.exempt) !== null)
    ) {
        return false;
    }
    active.blur();
    return true;
}
