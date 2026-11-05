import type { Router } from '@angular/router';
import type { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import type { PlaylistsService } from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistActions } from '@iptvnator/m3u-state';
/** Refresh the active local projection after a durable change. */
export async function refreshFavoriteViews(
    playlists: PlaylistsService,
    project: (playlist: Playlist) => Promise<Playlist>,
    router: Router,
    store: Store
) {
    store.dispatch(PlaylistActions.loadSharedPlaylists());
    const route = router.url;
    const id = route.match(/\/workspace\/playlists\/([^/?]+)/)?.[1];
    if (id) {
        const raw = await firstValueFrom(
            playlists.getPlaylistById(decodeURIComponent(id))
        );
        const playlist = await project(raw);
        if (router.url === route)
            store.dispatch(
                PlaylistActions.hydrateSharedPlaylist({
                    playlist,
                    playlistId: decodeURIComponent(id),
                })
            );
    }
    window.dispatchEvent(new Event('iptvnator-favorites-changed'));
}
