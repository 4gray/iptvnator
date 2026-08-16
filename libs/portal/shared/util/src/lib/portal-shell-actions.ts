import { InjectionToken } from '@angular/core';

export type PortalPlaylistType =
    | 'xtream'
    | 'url'
    | 'text'
    | 'file'
    | 'stalker'
    | 'auto';

export interface PortalShellActions {
    openAddPlaylistDialog(type?: PortalPlaylistType): void;
}

export const PORTAL_SHELL_ACTIONS = new InjectionToken<PortalShellActions>(
    'PORTAL_SHELL_ACTIONS'
);
