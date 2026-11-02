import { EnvironmentInjector, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistsService } from '@iptvnator/services';
import { SourceSyncService } from '@iptvnator/services/source-sync';
import { activityEnabled } from './activity-consent';
import { loadActivityRuntime } from './activity-sync.providers';

export function initializeSourceSync(): Promise<void> {
    const store = inject(Store);
    const router = inject(Router);
    const playlists = inject(PlaylistsService);
    const sync = inject(SourceSyncService);
    // A consented activity profile always belongs to this selected source server.
    if (activityEnabled())
        void loadActivityRuntime(inject(EnvironmentInjector)).catch(
            () => undefined
        );
    sync.changes.subscribe(() => {
        store.dispatch(PlaylistActions.loadSharedPlaylists());
        const activeId = router.url.match(
            /\/workspace\/(?:playlists|xtreams|stalker)\/([^/?]+)/
        )?.[1];
        if (activeId && !sync.sourceIds().has(decodeURIComponent(activeId))) {
            void router.navigateByUrl('/workspace/sources');
            return;
        }
        const activeM3uId = router.url.match(
            /\/workspace\/playlists\/([^/?]+)/
        )?.[1];
        if (activeM3uId) {
            const url = router.url;
            const id = decodeURIComponent(activeM3uId);
            void firstValueFrom(playlists.getPlaylistById(id))
                .then((playlist) => {
                    if (router.url === url && playlist?.playlist)
                        store.dispatch(
                            PlaylistActions.hydrateSharedPlaylist({
                                playlist,
                                playlistId: id,
                            })
                        );
                })
                .catch(() => undefined);
        }
    });
    return sync.initialize();
}
