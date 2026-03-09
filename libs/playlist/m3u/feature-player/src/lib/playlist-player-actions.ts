import { InjectionToken } from '@angular/core';

export interface PlaylistPlayerActions {
    openSettings(): void;
}

export const PLAYLIST_PLAYER_ACTIONS =
    new InjectionToken<PlaylistPlayerActions>('PLAYLIST_PLAYER_ACTIONS');
