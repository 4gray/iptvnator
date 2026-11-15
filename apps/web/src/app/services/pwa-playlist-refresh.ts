import type { Injector } from '@angular/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import { PlaylistsService } from '@iptvnator/services';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

const logger = createLogger('PwaService');

export async function refreshPwaPlaylist(
    injector: Injector,
    playlistId: string,
    url: string,
    savedUserAgent: string | undefined,
    download: (userAgent: string | undefined) => Promise<Playlist>,
    describeDownloadError: (error: unknown) => string
): Promise<void> {
    const userAgent = savedUserAgent?.trim() || undefined;
    const snackBar = injector.get(LazySnackBar);
    const translate = injector.get(TranslateService);
    let playlist: Playlist;
    try {
        playlist = await download(userAgent);
    } catch (error) {
        logger.error('Playlist refresh download failed:', error);
        void snackBar.open(
            describeDownloadError(error),
            translate.instant('CLOSE'),
            {
                duration: 5000,
            }
        );
        return;
    }

    // The matching DataService is already constructed when a refresh runs.
    const playlists = injector.get(PlaylistsService);
    const saved = await firstValueFrom(
        playlists.updatePlaylist(playlistId, {
            ...playlist,
            _id: playlistId,
            url,
            userAgent,
        })
    );
    injector.get(Store).dispatch(
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
}
