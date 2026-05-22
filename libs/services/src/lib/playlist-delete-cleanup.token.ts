import { InjectionToken } from '@angular/core';

export type PlaylistDeleteCleanup = (
    playlistId: string
) => Promise<void> | void;

export const PLAYLIST_DELETE_CLEANUP = new InjectionToken<
    PlaylistDeleteCleanup[]
>('PLAYLIST_DELETE_CLEANUP');
