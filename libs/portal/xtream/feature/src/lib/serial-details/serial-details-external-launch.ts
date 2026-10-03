import type {
    PortalExternalPlayback,
    PortalPlayer,
} from '@iptvnator/portal/shared/util';
import type {
    ExternalPlayerName,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { closeRunningExternalSession } from '../vod-details/vod-details-external-session';

/** What a forced MPV/VLC episode launch reads from the series page. */
export interface SeriesExternalLaunchHost {
    readonly portalPlayer: Pick<PortalPlayer, 'openExternalPlayback'>;
    readonly externalPlayback: Pick<
        PortalExternalPlayback,
        'activeSession' | 'closeSession'
    >;
    /** `playlist:series` on screen, null once the page is gone. */
    launchOwner(): string | null;
}

/** `owner:episode` keys of launches that have not settled yet. */
const launchesInFlight = new Set<string>();
/** Per owner, the tail of its launch chain: a second episode waits its turn. */
const launchChains = new Map<string, Promise<unknown>>();

/**
 * The "…" menu's MPV/VLC launch of an episode. An episode of this series
 * still running externally is closed first: with instance reuse off a
 * second detached player would start beside it. When that close fails, or
 * the user moved on while it ran, the running player stays and nothing new
 * launches. A repeat of the same episode before its launch settled
 * (Electron publishes the session only afterwards) is ignored; another
 * episode of the series waits for that launch to settle and then replaces
 * it like any later start.
 */
export async function openEpisodeExternally(
    host: SeriesExternalLaunchHost,
    playback: ResolvedPortalPlayback,
    player: ExternalPlayerName
): Promise<ExternalPlayerSession | void> {
    const owner = host.launchOwner();
    if (!owner) {
        return;
    }
    const key = `${owner}:${playback.contentInfo?.contentXtreamId ?? playback.streamUrl}`;
    if (launchesInFlight.has(key)) {
        return;
    }
    launchesInFlight.add(key);
    const previous = launchChains.get(owner) ?? Promise.resolve();
    const run = previous.then(() =>
        launchEpisode(host, owner, playback, player)
    );
    const tail = run.catch(() => undefined);
    launchChains.set(owner, tail);
    try {
        return await run;
    } finally {
        launchesInFlight.delete(key);
        if (launchChains.get(owner) === tail) {
            launchChains.delete(owner);
        }
    }
}

async function launchEpisode(
    host: SeriesExternalLaunchHost,
    owner: string,
    playback: ResolvedPortalPlayback,
    player: ExternalPlayerName
): Promise<ExternalPlayerSession | void> {
    const session = host.externalPlayback.activeSession();
    const info = session?.contentInfo;
    const ownSession =
        session &&
        info &&
        session.status !== 'closed' &&
        info.contentType === 'episode' &&
        `${info.playlistId}:${info.seriesXtreamId}` === owner
            ? session
            : null;
    const replaced = await closeRunningExternalSession(
        ownSession,
        (running) => host.externalPlayback.closeSession(running),
        (message, error) =>
            console.warn(`[SerialDetailsPlayback] ${message}`, error)
    );
    if (!replaced || host.launchOwner() !== owner) {
        return;
    }
    return host.portalPlayer.openExternalPlayback(playback, player);
}
