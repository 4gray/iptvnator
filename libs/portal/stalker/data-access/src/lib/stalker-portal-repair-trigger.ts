import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    getStalkerRequestErrorStatus,
    isStalkerAuthFailureMessage,
    isStalkerAuthFailureResponse,
} from './stalker-portal-discovery.utils';

/** Only failures that can prove a wrong endpoint or mode trigger discovery. */
export function shouldAttemptStalkerPortalRepair(
    playlist: PlaylistMeta,
    failure: unknown
): boolean {
    if (!playlist._id || !playlist.portalUrl || !playlist.macAddress) {
        return false;
    }

    if (isStalkerAuthFailureResponse(failure)) {
        return true;
    }

    const status = getStalkerRequestErrorStatus(failure);
    if (status === 404 || status === 401 || status === 403) {
        // 404: the persisted endpoint does not exist on this server.
        // 401/403: a token-free-classified playlist hit an HTTP auth
        // gate — discovery classifies these endpoints as auth-required,
        // so the repair must be allowed to reach it.
        return true;
    }

    if (
        failure !== null &&
        typeof failure === 'object' &&
        'message' in failure
    ) {
        const message = String(
            (failure as { message?: unknown }).message ?? ''
        );
        // The SAME failure set the session service uses for error
        // messages — authentication wraps structured denials as
        // `Error('Profile error: Access denied.')` or
        // `Error('Profile error: Invalid token')`, and a narrower
        // pattern here would let those bypass the repair entirely.
        return (
            isStalkerAuthFailureMessage(message) ||
            /handshake failed/i.test(message)
        );
    }

    return false;
}
