import type { Injector } from '@angular/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistsService } from '@iptvnator/services';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { XtreamStartupRefreshService } from '@iptvnator/services/xtream-startup-refresh';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
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

            const updateDate = Date.now();
            const saved = await firstValueFrom(
                playlists.updatePlaylistMetaIfCurrent(
                    { _id: source._id, updateDate },
                    (current) =>
                        current?.serverUrl === source.serverUrl &&
                        current.username === source.username &&
                        current.password === source.password &&
                        current.userAgent === source.userAgent
                )
            );
            if (saved) {
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
    if (failed) showRefreshFailure(injector);
}

function showRefreshFailure(injector: Injector): void {
    const translate = injector.get(TranslateService);
    void injector
        .get(LazySnackBar)
        .open(
            translate.instant('HOME.PLAYLISTS.XTREAM_STARTUP_REFRESH_FAILED'),
            translate.instant('CLOSE'),
            { duration: 8000 }
        );
}
