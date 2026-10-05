import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { isPortalPlaybackWatched } from './portal-playback-positions';

export interface SeriesProgressRequest {
    readonly seasons: Readonly<Record<string, readonly XtreamSerieEpisode[]>>;
    readonly playbackPositions: ReadonlyMap<number, PlaybackPositionData>;
}

/** An episode in series order, with its saved position. */
export interface SeriesEpisodeEntry {
    readonly episode: XtreamSerieEpisode;
    readonly position: PlaybackPositionData | null;
    /** Index in season order, then episode order. */
    readonly order: number;
    /** The episode's own season number, else its season key's. */
    readonly seasonNumber: number | null;
    /** Filed under season 0, where providers keep extras (specials). */
    readonly special: boolean;
}

/**
 * Where a series goes on from its saved positions. Like Plex's On Deck and
 * Jellyfin's Next Up, it goes from the episode watched last, not from the
 * first gap in the list: a series started at season 2, or with an episode
 * skipped, goes on after the episode the user actually watched.
 *
 * Extras (season 0) stand apart from a series that has other seasons: they
 * never come next, never keep the series pending and never take its place,
 * not even one left unfinished. A series filed under season 0 alone has
 * nothing else, so there season 0 is the run.
 * - `resume`: the newest activity in the run is an episode left unfinished;
 * - `next`: the first unwatched episode after the one watched last, in
 *   series order; it may have been started before. When only extras were
 *   played, the first episode of the run;
 * - `caught-up`: no unwatched episode follows the one watched last.
 *   `skipped` is the first one left unwatched before it, `last` the final
 *   episode of the run;
 * - `start`: no episode of the list has been played.
 */
export type SeriesNextUp =
    | {
          readonly kind: 'start' | 'resume' | 'next';
          readonly entry: SeriesEpisodeEntry;
      }
    | {
          readonly kind: 'caught-up';
          readonly skipped: SeriesEpisodeEntry | null;
          readonly last: SeriesEpisodeEntry;
      };

const naturalCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

/** SQLite's CURRENT_TIMESTAMP: UTC, written without a zone. */
const SQLITE_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

export function getSeriesNextUp(
    request: SeriesProgressRequest
): SeriesNextUp | null {
    const entries = getOrderedSeriesEpisodes(request);
    const run = entries.some((entry) => !entry.special)
        ? entries.filter((entry) => !entry.special)
        : entries;
    if (run.length === 0) {
        return null;
    }
    const nextUp = getNextUpWithin(run);
    // Only extras were played: the run begins now.
    if (
        nextUp.kind === 'start' &&
        entries.some(({ position }) => position !== null)
    ) {
        return { kind: 'next', entry: nextUp.entry };
    }
    return nextUp;
}

/** The rule within one sequence of episodes, in series order. */
function getNextUpWithin(
    sequence: readonly SeriesEpisodeEntry[]
): SeriesNextUp {
    const lastWatched = newestEntry(
        sequence.filter(({ position }) => isPortalPlaybackWatched(position))
    );
    const lastStarted = newestEntry(
        sequence.filter(
            ({ position }) =>
                position !== null && !isPortalPlaybackWatched(position)
        )
    );
    if (
        lastStarted &&
        (!lastWatched || compareEntryRecency(lastStarted, lastWatched) > 0)
    ) {
        return { kind: 'resume', entry: lastStarted };
    }
    if (!lastWatched) {
        return { kind: 'start', entry: sequence[0] };
    }
    const unwatched = sequence.filter(
        (entry) => !isPortalPlaybackWatched(entry.position)
    );
    const next = unwatched.find((entry) => entry.order > lastWatched.order);
    if (next) {
        return { kind: 'next', entry: next };
    }
    return {
        kind: 'caught-up',
        skipped: unwatched[0] ?? null,
        last: sequence[sequence.length - 1],
    };
}

/** Seasons in natural order ("Season 2" before "Season 10"), then episodes. */
function getOrderedSeriesEpisodes(
    request: SeriesProgressRequest
): SeriesEpisodeEntry[] {
    const entries: SeriesEpisodeEntry[] = [];
    Object.entries(request.seasons)
        .sort(([seasonA], [seasonB]) =>
            naturalCollator.compare(seasonA, seasonB)
        )
        .forEach(([seasonKey, episodes]) => {
            [...episodes].sort(compareEpisodes).forEach((episode) => {
                const seasonNumber =
                    toSeasonNumber(episode.season) ?? toSeasonNumber(seasonKey);
                entries.push({
                    episode,
                    position:
                        request.playbackPositions.get(Number(episode.id)) ??
                        null,
                    order: entries.length,
                    seasonNumber,
                    special: seasonNumber === 0,
                });
            });
        });
    return entries;
}

function compareEpisodes(
    episodeA: XtreamSerieEpisode,
    episodeB: XtreamSerieEpisode
): number {
    const episodeNumberDelta =
        Number(episodeA.episode_num) - Number(episodeB.episode_num);

    if (Number.isFinite(episodeNumberDelta) && episodeNumberDelta !== 0) {
        return episodeNumberDelta;
    }

    return naturalCollator.compare(episodeA.title ?? '', episodeB.title ?? '');
}

function toSeasonNumber(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') {
        return null;
    }
    const text = String(value).trim();
    const number = Number(text);
    return text !== '' && Number.isFinite(number) ? number : null;
}

function newestEntry(
    entries: readonly SeriesEpisodeEntry[]
): SeriesEpisodeEntry | null {
    let newest: SeriesEpisodeEntry | null = null;
    for (const entry of entries) {
        if (!newest || compareEntryRecency(entry, newest) > 0) {
            newest = entry;
        }
    }
    return newest;
}

/** By save time; saves without one, or at the same time, by series order. */
function compareEntryRecency(
    entryA: SeriesEpisodeEntry,
    entryB: SeriesEpisodeEntry
): number {
    const delta =
        getTimestamp(entryA.position?.updatedAt) -
        getTimestamp(entryB.position?.updatedAt);
    return delta !== 0 ? delta : entryA.order - entryB.order;
}

/**
 * SQLite rows are UTC without a zone, which `Date.parse` alone would read as
 * local time and misorder against the ISO times the renderer writes.
 */
function getTimestamp(value: string | undefined): number {
    if (!value) {
        return 0;
    }
    const timestamp = Date.parse(
        SQLITE_UTC_TIMESTAMP.test(value) ? `${value.replace(' ', 'T')}Z` : value
    );
    return Number.isFinite(timestamp) ? timestamp : 0;
}
