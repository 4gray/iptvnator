import {
    executeStalkerRequest,
    StalkerRequestDeps,
} from '@iptvnator/portal/stalker/data-access';
import { Playlist } from '@iptvnator/shared/interfaces';

export async function executeStalkerSearchRequest<T>(
    deps: StalkerRequestDeps,
    playlist: Playlist,
    params: Record<string, string | number>
): Promise<T> {
    const isFullPortal =
        playlist.isFullStalkerPortal ??
        deps.stalkerSession.isFullStalkerPortal(playlist.portalUrl ?? '');

    return executeStalkerRequest<T>(
        deps,
        isFullPortal
            ? {
                  ...playlist,
                  isFullStalkerPortal: true,
              }
            : playlist,
        params
    );
}
