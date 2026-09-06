import { InjectionToken } from '@angular/core';

/**
 * Opens the live categories list as a popover anchored to an element.
 *
 * While the categories rail is folded (`LiveLayoutSidebarStateService.
 * areCategoriesHidden`), the channels header turns its category title into a
 * dropdown so switching categories stays one click away. The rail itself is
 * shell-owned (`WorkspaceContextPanelComponent`), which the portal feature
 * libs cannot import, so the workspace shell provides this token and the live
 * layouts inject it optionally: without a provider (unit tests, a host that
 * renders no categories rail) the dropdown is simply not offered.
 */
export interface LiveCategoriesPopover {
    /**
     * Opens the popover below `origin`, or closes it when it is already open
     * for that origin.
     */
    open(origin: HTMLElement): void;
    /** Closes the popover if it is open. */
    close(): void;
    /**
     * Brings the categories rail back (level 1) the way the current viewport
     * shows it: on desktop the in-flow rail unfolds; at phone widths the rail
     * is the shell's off-canvas drawer, whose open state is separate from
     * the fold level, so the drawer is opened as well. Closes the popover.
     */
    showCategoriesPanel(): void;
}

export const LIVE_CATEGORIES_POPOVER = new InjectionToken<LiveCategoriesPopover>(
    'LIVE_CATEGORIES_POPOVER'
);
