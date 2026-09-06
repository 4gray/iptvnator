import { effect, Signal, untracked } from '@angular/core';
import { LiveSidebarState } from './live-sidebar-state';

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

/**
 * Installs the focus handoff for a live layout's panel toggles. Must run in
 * an injection context (a component constructor). After every level change
 * and the render it causes, `targetFor(next)` names the affordance that now
 * stands in for the button the user activated — the floating restore handle
 * at player-only, the show-categories button while the rail is folded, and
 * nothing when the categories rail itself is back (its own component picks
 * focus up then) — and focus moves there only if it was lost.
 */
export function handoffFocusOnLiveSidebarChange(
    state: Signal<LiveSidebarState>,
    targetFor: (next: LiveSidebarState) => HTMLElement | null | undefined
): void {
    let previous = untracked(state);
    effect(() => {
        const next = state();
        if (next === previous) {
            return;
        }
        previous = next;
        queueMicrotask(() => focusIfFocusLost(untracked(() => targetFor(next))));
    });
}
