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
    return executeStalkerRequest<T>(deps, playlist, params);
}
