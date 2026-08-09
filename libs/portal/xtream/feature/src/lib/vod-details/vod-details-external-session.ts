import type {
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { isLiveExternalPlayerSession } from '@iptvnator/portal/shared/util';

/**
 * Which external player process, and which position rows, belong to this page.
 *
 * Multi-source makes both questions harder than they look: playback can be on
 * a copy of the film in ANOTHER playlist, whose ids the session and the
 * position rows then carry. A source handoff also waits for exact process
 * teardown before the destination can become active.
 */

/** Ids this page owns, beyond the route's own copy. */
export interface OwnedContentIds {
    routePlaylistId: string | undefined;
    routeContentId: number | undefined;
    /** The alternative currently in use, if it is not the route's own. */
    alternative: PlayerContentInfo | null;
}

/**
 * Whether a position update refers to content this page owns.
 *
 * An absent playlist id must never match an absent current playlist, or
 * `undefined === undefined` would adopt a stranger's progress.
 */
export function ownsContent(
    info:
        | {
              playlistId?: string;
              contentXtreamId?: number;
              contentType?: string;
          }
        | undefined,
    owned: OwnedContentIds
): boolean {
    if (!info?.playlistId || info.contentType !== 'vod') {
        return false;
    }

    const { alternative } = owned;
    return (
        (info.playlistId === owned.routePlaylistId &&
            info.contentXtreamId === owned.routeContentId) ||
        (!!alternative &&
            info.playlistId === alternative.playlistId &&
            info.contentXtreamId === alternative.contentXtreamId)
    );
}

/**
 * The external process this page started, if it is still up.
 *
 * Matched on the ids we LAUNCHED with rather than only on what is active now:
 * refreshes and overlapping handoffs may update controller state while exact
 * process teardown is still in flight.
 */
export function runningExternalSession(
    session: ExternalPlayerSession | null,
    launched: PlayerContentInfo | null,
    matched: ExternalPlayerSession | null
): ExternalPlayerSession | null {
    if (
        !session?.contentInfo ||
        session.status === 'closed' ||
        (session.status === 'error' && !session.canClose)
    ) {
        return null;
    }

    const info = session.contentInfo;
    const isLaunchedOne =
        !!launched &&
        info.playlistId === launched.playlistId &&
        info.contentXtreamId === launched.contentXtreamId;

    return isLaunchedOne ? session : matched;
}

/**
 * Close the running external player before its replacement starts.
 *
 * A failed close leaves teardown unconfirmed. Report false so the caller can
 * cancel the replacement instead of starting a second external process.
 */
export async function closeRunningExternalSession(
    session: ExternalPlayerSession | null,
    close: (session: ExternalPlayerSession) => Promise<void>,
    warn: (message: string, error: unknown) => void
): Promise<boolean> {
    if (!session) {
        return true;
    }
    if (isLiveExternalPlayerSession(session) && !session.canClose) {
        return false;
    }

    try {
        await close(session);
        return true;
    } catch (error) {
        warn(
            'Closing the previous external player failed; cancelling the replacement.',
            error
        );
        return false;
    }
}
