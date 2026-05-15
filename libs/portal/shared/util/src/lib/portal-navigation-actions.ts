import { InjectionToken } from '@angular/core';
import { Playlist } from '@iptvnator/shared/interfaces';

export interface PortalNavigationActions {
    openAccountInfo(): void;
    openPlaylistInfo(playlist: Playlist | null | undefined): void;
    openSettings(): void;
}

export const PORTAL_NAVIGATION_ACTIONS =
    new InjectionToken<PortalNavigationActions>('PORTAL_NAVIGATION_ACTIONS');
