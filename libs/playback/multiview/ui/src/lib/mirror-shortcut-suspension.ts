import { DestroyRef, effect, inject, untracked } from '@angular/core';

/** The player-controls contract's marker for a surface that owns the keys. */
export const SHORTCUTS_SUSPENDED_ATTRIBUTE = 'data-player-shortcuts-suspended';

/**
 * The tiles live in the stage, outside the anchor view's player container.
 * When the view hands the keyboard to a surface of its own (the M3U guide
 * marks its player container), the stage carries the same marker, so the
 * tiles' player shortcuts stand down as the view's own player would.
 * Must be called in an injection context.
 */
export function mirrorShortcutSuspension(
    host: HTMLElement,
    anchor: () => HTMLElement | null
): void {
    const sync = (): void => {
        const suspended = !!anchor()?.closest(
            `[${SHORTCUTS_SUSPENDED_ATTRIBUTE}]`
        );
        host.toggleAttribute(SHORTCUTS_SUSPENDED_ATTRIBUTE, suspended);
    };
    const observer = new MutationObserver(() => untracked(sync));
    observer.observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: [SHORTCUTS_SUSPENDED_ATTRIBUTE],
    });
    effect(() => {
        anchor();
        untracked(sync);
    });
    inject(DestroyRef).onDestroy(() => observer.disconnect());
}
