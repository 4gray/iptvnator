import type { Injector } from '@angular/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { NotificationService } from '@iptvnator/services/notifications';
import { XtreamStartupRefreshService } from '@iptvnator/services/xtream-startup-refresh';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';

export async function refreshXtreamPlaylistsOnStartup(
    injector: Injector,
    sources: PlaylistMeta[]
): Promise<void> {
    const refresh = injector.get(XtreamStartupRefreshService);
    const store = injector.get(Store);
    let failed = false;

    for (const source of sources) {
        try {
            const updateDate = await refresh.refreshLive(source);
            if (updateDate === false) continue;

            window.dispatchEvent(new Event('iptvnator-favorites-changed'));
            window.dispatchEvent(new Event('iptvnator-history-changed'));
            store.dispatch(
                PlaylistActions.xtreamStartupRefreshCommitted({
                    playlistId: source._id,
                    updateDate,
                })
            );
        } catch {
            failed = true;
        }
    }
    if (failed)
        injector
            .get(NotificationService)
            .error('HOME.PLAYLISTS.XTREAM_STARTUP_REFRESH_FAILED');
}
