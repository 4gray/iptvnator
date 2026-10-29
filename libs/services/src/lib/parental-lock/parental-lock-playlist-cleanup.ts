import { inject, Provider } from '@angular/core';
import { PLAYLIST_DELETE_CLEANUP } from '../playlist-delete-cleanup.token';
import { ParentalLockService } from './parental-lock.service';

/**
 * Removes a deleted playlist's locks from the persisted lock store. Every
 * direct single-playlist deletion runs `PlaylistsService.deletePlaylist`;
 * remote source projections run the same hooks after the row is gone. "Remove
 * all playlists" clears the store through `ParentalLockService.clearAllLocks`
 * instead.
 */
export function provideParentalLockPlaylistCleanup(): Provider {
    return {
        provide: PLAYLIST_DELETE_CLEANUP,
        multi: true,
        useFactory: () => {
            const parentalLock = inject(ParentalLockService);
            return async (playlistId: string) => {
                if (!(await parentalLock.removePlaylistLocks(playlistId))) {
                    throw new Error(
                        'The parental locks of the deleted playlist could not be removed.'
                    );
                }
            };
        },
    };
}
