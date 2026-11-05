import {
    isFullStalkerPortalPlaylist,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import { stalkerSessionFingerprint } from '@iptvnator/shared/interfaces/stalker-session';

/** Keep a confirmed local Edit session only for its accepted connection. */
export function invalidateObsoleteSourceSession(next: Playlist): Playlist {
    if (
        next.macAddress &&
        isFullStalkerPortalPlaylist(next) &&
        next.stalkerToken &&
        next.stalkerSessionIdentity === stalkerSessionFingerprint(next)
    )
        return next;
    delete next.stalkerToken;
    delete next.stalkerSessionIdentity;
    delete next.stalkerAccountInfo;
    delete next.stalkerWatchdogTimeout;
    delete next.stalkerTimeslot;
    delete next.serverTimezone;
    return next;
}
