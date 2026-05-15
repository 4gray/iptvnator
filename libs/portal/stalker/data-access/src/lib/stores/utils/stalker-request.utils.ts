import { DataService } from '@iptvnator/services';
import { Playlist, PlaylistMeta, STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';

export interface StalkerRequestDeps {
    dataService: DataService;
    stalkerSession: StalkerSessionService;
}

export function toStalkerSessionPlaylist(playlist: PlaylistMeta): Playlist {
    return {
        lastUsage: '',
        ...playlist,
    } as Playlist;
}

export async function executeStalkerRequest<T>(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    params: Record<string, string | number>
): Promise<T> {
    if (playlist.isFullStalkerPortal) {
        return deps.stalkerSession.makeAuthenticatedRequest<T>(
            toStalkerSessionPlaylist(playlist),
            params
        );
    }

    return deps.dataService.sendIpcEvent<T>(STALKER_REQUEST, {
        url: playlist.portalUrl,
        macAddress: playlist.macAddress,
        params,
    });
}
