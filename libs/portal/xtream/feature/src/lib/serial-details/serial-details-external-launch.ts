import { signal } from '@angular/core';
import type {
    PortalExternalPlayback,
    PortalPlayer,
} from '@iptvnator/portal/shared/util';
import type {
    ExternalPlayerName,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    createLogger,
    isLiveExternalPlayerSession,
} from '@iptvnator/portal/shared/util';
import { closeRunningExternalSession } from '../vod-details/vod-details-external-session';

const logger = createLogger('SerialDetailsPlayback');

/** The episode ids an external session contributes to the series page. */
export interface ExternalEpisodeSessionIds {
    readonly opening: number | null;
    readonly active: number | null;
}

/**
 * Which episode of the shown series the active external session is
 * opening or playing; both null when the session belongs to something
 * else or has ended.
 */
export function externalEpisodeSessionIds(
    session: ExternalPlayerSession | null,
    seriesXtreamId: string | number | undefined,
    playlistId: string
): ExternalEpisodeSessionIds {
    const info = session?.contentInfo;
    if (
        !session ||
        !info ||
        !seriesXtreamId ||
        !playlistId ||
        info.contentType !== 'episode' ||
        info.playlistId !== playlistId ||
        info.seriesXtreamId !== Number(seriesXtreamId)
    ) {
        return { opening: null, active: null };
    }
    if (session.status === 'launching') {
        return { opening: info.contentXtreamId, active: null };
    }
    if (isLiveExternalPlayerSession(session)) {
        return { opening: null, active: info.contentXtreamId };
    }
    return { opening: null, active: null };
}

/** What a forced MPV/VLC episode launch reads from the series page. */
export interface SeriesExternalLaunchHost {
    readonly portalPlayer: Pick<PortalPlayer, 'openExternalPlayback'>;
    readonly externalPlayback: Pick<
        PortalExternalPlayback,
        'activeSession' | 'closeSession'
    >;
    /** `playlist:series` on screen, null once the page is gone. */
    launchOwner(): string | null;
    /** Owner plus visit: a reopened series is a new page for the duplicate guard. */
    pageToken(): string;
}

/** `page:episode` keys of launches that have not settled yet. */
const launchesInFlight = new Set<string>();
/** Per owner, the tail of its launch chain: a second episode waits its turn. */
const launchChains = new Map<string, Promise<unknown>>();
/** Owners with a launch in flight, reactive for the hosts' start guards. */
const pendingOwners = signal<ReadonlyMap<string, number>>(new Map());

function countPending(owner: string, delta: number): void {
    pendingOwners.update((owners) => {
        const next = new Map(owners);
        const count = (next.get(owner) ?? 0) + delta;
        if (count > 0) {
            next.set(owner, count);
        } else {
            next.delete(owner);
        }
        return next;
    });
}

/** Whether a forced launch of this owner (`playlist:series`) has not settled yet. */
export function isEpisodeLaunchPending(owner: string | null): boolean {
    return !!owner && (pendingOwners().get(owner) ?? 0) > 0;
}

/** Resolves once every queued launch of the owner settled (at once when none is pending). */
export function whenEpisodeLaunchesSettle(owner: string | null): Promise<void> {
    const tail = owner ? launchChains.get(owner) : undefined;
    return tail ? tail.then(() => undefined) : Promise.resolve();
}

/** What replaying a queued choice reads from the page that made it. */
type QueuedChoiceHost = Pick<
    SeriesExternalLaunchHost,
    'externalPlayback' | 'launchOwner'
>;

interface QueuedEpisodeChoice {
    readonly host: QueuedChoiceHost;
    readonly episode: unknown;
    readonly start: (episode: never) => void;
}

/** Per owner, the latest Play/episode choice made while its forced launch settled. */
const queuedChoices = new Map<string, QueuedEpisodeChoice>();

/**
 * Keeps the latest choice made while the owner's forced launch settles and
 * hands it to the `start` that came with it once that launch settled. One
 * settle handler per owner: a page reopened meanwhile queues with its own
 * `host` and `start`, and those run, not the ones of the page the viewer left.
 */
export function queueEpisodeChoice<TEpisode>(
    host: QueuedChoiceHost,
    owner: string,
    episode: TEpisode,
    start: (episode: TEpisode) => void
): void {
    const handlerRegistered = queuedChoices.has(owner);
    queuedChoices.set(owner, {
        host,
        episode,
        start: start as (episode: never) => void,
    });
    if (handlerRegistered) {
        return;
    }
    void whenEpisodeLaunchesSettle(owner).then(() => replayQueuedChoice(owner));
}

/**
 * The settled launch opened a player for the series; the queued choice
 * replaces it, never plays beside it. The owner stays pending while that
 * player closes so no other start slips in between. The choice is dropped
 * when the page moved on meanwhile or the player has to stay.
 */
async function replayQueuedChoice(owner: string): Promise<void> {
    const queued = queuedChoices.get(owner);
    if (!queued) {
        return;
    }
    if (queued.host.launchOwner() !== owner) {
        queuedChoices.delete(owner);
        return;
    }
    countPending(owner, 1);
    let replaced = false;
    try {
        replaced = await closeOwnedEpisodeSession(queued.host, owner);
    } finally {
        countPending(owner, -1);
    }
    // The entry stayed in the map while the player closed, so a choice made
    // meanwhile replaced it instead of registering a second replay: the
    // latest choice wins.
    const latest = queuedChoices.get(owner);
    queuedChoices.delete(owner);
    if (latest && replaced && latest.host.launchOwner() === owner) {
        latest.start(latest.episode as never);
    }
}

/**
 * Closes the external session when it plays an episode of `owner`; false
 * when it has to stay (the close failed) and nothing may start beside it.
 */
function closeOwnedEpisodeSession(
    host: Pick<SeriesExternalLaunchHost, 'externalPlayback'>,
    owner: string
): Promise<boolean> {
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
    return closeRunningExternalSession(
        ownSession,
        (running) => host.externalPlayback.closeSession(running),
        (message, error) => logger.warn(message, error)
    );
}

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
    // Keyed by the visit, not the owner: a launch left behind by an earlier
    // visit of the same series must not swallow the reopened page's click,
    // which instead queues behind it on the owner's chain.
    const key = `${host.pageToken()}:${playback.contentInfo?.contentXtreamId ?? playback.streamUrl}`;
    if (launchesInFlight.has(key)) {
        return;
    }
    launchesInFlight.add(key);
    countPending(owner, 1);
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
        countPending(owner, -1);
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
    // Queued behind another launch: the page may have moved on meanwhile,
    // and the running player then belongs to a series the viewer left.
    if (host.launchOwner() !== owner) {
        return;
    }
    const replaced = await closeOwnedEpisodeSession(host, owner);
    if (!replaced || host.launchOwner() !== owner) {
        return;
    }
    const session = await host.portalPlayer.openExternalPlayback(
        playback,
        player
    );
    // The page moved on while the launch sat inside the player IPC: pending
    // launches are owner-scoped, so the new title may already play, and the
    // player this one opened must not stay beside it.
    if (session && host.launchOwner() !== owner) {
        try {
            await host.externalPlayback.closeSession(session);
        } catch (error) {
            logger.warn('Closing a superseded external player failed', error);
        }
        return;
    }
    return session;
}
