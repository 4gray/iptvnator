/**
 * Moves focus to `element` only when the document has none to speak of:
 * the previously focused control was removed or made `inert`, so focus
 * already fell back to `<body>`. A control that still owns focus (a mouse
 * user's category row, a keyboard user's search box) is left alone.
 *
 * Used by the live-TV panel toggles: hiding a rail removes the button that
 * was just activated, and the replacement affordance lives in another
 * component, so the receiving side picks focus up after its next render.
 */
export function focusIfFocusLost(
    element: HTMLElement | null | undefined
): void {
    if (!element || !element.isConnected) {
        return;
    }
    const active = document.activeElement;
    const focusLost =
        !active || active === document.body || active.closest('[inert]') !== null;
    if (focusLost) {
        element.focus();
    }
}
