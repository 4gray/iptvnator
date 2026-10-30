import { Signal } from '@angular/core';

/**
 * How Back shares the phone header (≤640 px) with the context drawer toggle
 * on routes that have one.
 *
 * - `replace` (default): Back takes the toggle's slot. The drawer belongs to
 *   the list Back returns to (detail pages), which shows the toggle again.
 * - `beside`: both stay. The drawer holds the page's own navigation
 *   (settings sections), so hiding its toggle would strand it.
 * - `yield`: Back hides while the toggle shows. Used by the history
 *   fallback, so a category list never loses its drawer to it.
 */
export type WorkspaceBackPhoneSlot = 'replace' | 'beside' | 'yield';

/** A page's Back action, rendered in the workspace header's leading slot. */
export interface WorkspaceBackTarget {
    /** Accessible name and tooltip; null falls back to the generic "Back". */
    readonly label: Signal<string | null>;
    /** True while Escape on the page runs the same action. */
    readonly escapeShortcut: Signal<boolean>;
    /** Phone-width placement beside the drawer toggle; `replace` if unset. */
    readonly phoneDrawerToggle?: WorkspaceBackPhoneSlot;
    run(): void;
}
