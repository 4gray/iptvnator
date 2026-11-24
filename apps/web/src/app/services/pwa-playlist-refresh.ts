import type { Injector } from '@angular/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
import { PlaylistsService } from '@iptvnator/services';
import {
    type NotificationMessage,
    NotificationService,
} from '@iptvnator/services/notifications';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';

const logger = createLogger('PwaService');

/** Resolves whether the playlist was loaded; a failed download is reported. */
export async function refreshPwaPlaylist(
    injector: Injector,
    playlistId: string,
    url: string,
    savedUserAgent: string | undefined,
    download: (userAgent: string | undefined) => Promise<Playlist>,
    describeDownloadError: (error: unknown) => NotificationMessage & {
        code?: string;
    }
): Promise<boolean> {
    const userAgent = savedUserAgent?.trim() || undefined;
    const notifications = injector.get(NotificationService);
    let playlist: Playlist;
    try {
        playlist = await download(userAgent);
    } catch (error) {
        logger.error('Playlist refresh download failed:', error);
        const { key, params, code } = describeDownloadError(error);
        notifications.error(key, params, { code });
        return false;
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
    notifications.success('HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS');
    return true;
}
