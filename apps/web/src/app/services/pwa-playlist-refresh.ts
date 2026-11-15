import type { Injector } from '@angular/core';
import type { Store } from '@ngrx/store';
import type { TranslateService } from '@ngx-translate/core';
import type { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistsService } from '@iptvnator/services';
import type { createLogger } from '@iptvnator/portal/shared/util/logger';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { firstValueFrom, type Observable } from 'rxjs';

/**
 * What a browser playlist refresh needs from `PwaService`. Loaded on the
 * first refresh, so the download-and-save flow stays off the startup path
 * (`renderer.initialBytes`).
 */
export interface PwaPlaylistRefreshDeps {
    injector: Pick<Injector, 'get'>;
    store: Pick<Store, 'dispatch'>;
    snackBar: Pick<LazySnackBar, 'open'>;
    translate: Pick<TranslateService, 'instant'>;
    logger: ReturnType<typeof createLogger>;
    download: (url: string, userAgent?: string) => Observable<Playlist>;
    /** The localized download failure, with the proxy's network code. */
    downloadErrorMessage: (error: unknown) => string;
}

/** Downloads, saves and publishes a playlist; settles after reporting. */
export async function refreshPwaPlaylist(
    deps: PwaPlaylistRefreshDeps,
    payload: Partial<Playlist & { id: string }>
): Promise<void> {
    if (!payload.url || !payload.id) {
        return;
    }

    const playlistId = payload.id;
    const { url } = payload;
    const userAgent = payload.userAgent?.trim() || undefined;
    const { translate, snackBar } = deps;

    let playlist: Playlist;
    try {
        playlist = await firstValueFrom(deps.download(url, userAgent));
    } catch (error) {
        // Redacted: the error can carry the playlist URL.
        deps.logger.error('Playlist refresh download failed:', error);
        void snackBar.open(
            deps.downloadErrorMessage(error),
            translate.instant('CLOSE'),
            { duration: 5000 }
        );
        return;
    }

    try {
        // Resolve after construction: PlaylistsService uses the runtime
        // DataService, which resolves to PwaService in the browser.
        const playlists = deps.injector.get(PlaylistsService);
        const saved = await firstValueFrom(
            playlists.updatePlaylist(playlistId, {
                ...playlist,
                _id: playlistId,
                url,
                userAgent,
            })
        );
        deps.store.dispatch(
            PlaylistActions.updatePlaylist({
                playlist: saved,
                playlistId,
                refreshEpg: true,
                persist: false,
            })
        );
        void snackBar.open(
            translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'),
            undefined,
            { duration: 2000 }
        );
    } catch (error) {
        deps.logger.error('Playlist refresh save failed:', error);
        void snackBar.open(
            translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_FAILED'),
            translate.instant('CLOSE'),
            { duration: 5000 }
        );
    }
}
