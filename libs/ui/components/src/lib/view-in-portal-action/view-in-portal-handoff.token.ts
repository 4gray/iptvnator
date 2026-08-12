import { InjectionToken, Signal } from '@angular/core';

/**
 * Contract a collection-detail host provides to surface the
 * "View in portal" action inside a projected detail view. The token is
 * deliberately absent in router-mounted portal details, which is what keeps
 * the action scoped to inline collection contexts (global and portal-scoped
 * favorites/recent).
 *
 * Member names carry the `viewInPortal` prefix so hosts can implement the
 * interface directly without clashing with their existing members.
 */
export interface ViewInPortalHandoff {
    readonly viewInPortalAvailable: Signal<boolean>;
    readonly viewInPortalPlaylistName: Signal<string | null>;
    openInPortal(): void;
}

export const VIEW_IN_PORTAL_HANDOFF = new InjectionToken<ViewInPortalHandoff>(
    'VIEW_IN_PORTAL_HANDOFF'
);
