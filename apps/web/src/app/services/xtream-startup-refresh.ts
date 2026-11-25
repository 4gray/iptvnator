import type { Injector } from '@angular/core';
import { PlaylistActions, selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { PlaylistsService } from '@iptvnator/services';
import { NotificationService } from '@iptvnator/services/notifications';
import { XtreamStartupRefreshService } from '@iptvnator/services/xtream-startup-refresh';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';

export async function refreshXtreamPlaylistsOnStartup(
    injector: Injector,
    sources: PlaylistMeta[]
): Promise<void> {
    const refresh = injector.get(XtreamStartupRefreshService);
    const playlists = injector.get(PlaylistsService);
    const store = injector.get(Store);
    let failed = false;

    for (const source of sources) {
        try {
            if (!(await refresh.refreshLive(source))) continue;

            window.dispatchEvent(new Event('iptvnator-favorites-changed'));
            window.dispatchEvent(new Event('iptvnator-history-changed'));

            const updateDate = Date.now();
            const sameSource = (current?: PlaylistMeta) =>
                !!current &&
                current.serverUrl === source.serverUrl &&
                current.username === source.username &&
                current.password === source.password &&
                current.userAgent === source.userAgent;
            let publish: boolean;
            try {
                publish = Boolean(
                    await firstValueFrom(
                        playlists.updatePlaylistMetaIfCurrent(
                            { _id: source._id, updateDate },
                            sameSource
                        )
                    )
                );
            } catch {
                failed = true;
                // The catalog already committed. Refresh the current view
                // even if its display timestamp couldn't be persisted.
                const current = (
                    await firstValueFrom(store.select(selectAllPlaylistsMeta))
                ).find(({ _id }) => _id === source._id);
                publish =
                    current?.updateDate === source.updateDate &&
                    sameSource(current);
            }
            if (publish) {
                refresh.recordUpdate(source._id, updateDate);
                store.dispatch(
                    PlaylistActions.xtreamStartupRefreshCommitted({
                        playlistId: source._id,
                        updateDate,
                    })
                );
            }
        } catch {
            failed = true;
        }
    }
    if (failed)
        injector
            .get(NotificationService)
            .error('HOME.PLAYLISTS.XTREAM_STARTUP_REFRESH_FAILED');
}
