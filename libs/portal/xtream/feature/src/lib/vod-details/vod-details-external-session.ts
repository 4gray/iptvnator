import type {
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';

/**
 * Which external player process, and which position rows, belong to this page.
 *
 * Multi-source makes both questions harder than they look: playback can be on
 * a copy of the film in ANOTHER playlist, whose ids the session and the
 * position rows then carry, and during a switch the controller has already
 * moved "active" to the destination before playback is handed over.
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
        | { playlistId?: string; contentXtreamId?: number; contentType?: string }
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
 * Matched on the ids we LAUNCHED with rather than on what is active now: a
 * switch marks the destination active before handing playback over, so asking
 * "is this session ours?" at that moment answers no and leaves the running
 * process playing beside its replacement.
 */
export function runningExternalSession(
    session: ExternalPlayerSession | null,
    launched: PlayerContentInfo | null,
    matched: ExternalPlayerSession | null
): ExternalPlayerSession | null {
    if (
        !session?.contentInfo ||
        session.status === 'closed' ||
        session.status === 'error'
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
 * A failure is logged rather than propagated: the caller has already
 * committed the switch, so refusing to launch would leave the page naming a
 * source with nothing playing — worse than a possibly-lingering process, and
 * a close that rejects usually means the session was gone already.
 */
export async function closeRunningExternalSession(
    session: ExternalPlayerSession | null,
    close: (session: ExternalPlayerSession) => Promise<void>,
    warn: (message: string, error: unknown) => void
): Promise<void> {
    if (!session) {
        return;
    }

    try {
        await close(session);
    } catch (error) {
        warn(
            'Closing the previous external player failed; starting the replacement anyway.',
            error
        );
    }
}
