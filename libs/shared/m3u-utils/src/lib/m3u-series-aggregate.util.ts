import { hashM3uId, normalizeTitleKeys } from '@iptvnator/shared/interfaces';
import { M3uEpisodeParse, parseM3uEpisode } from './m3u-episode-parse.util';
import {
    M3uArtworkBearing,
    M3uSeries,
    M3uSeriesAccumulator,
    M3uSeriesEpisode,
} from './m3u-series-model';
import {
    regroupM3uSeriesByYear,
    remintM3uEpisodeIds,
} from './m3u-series-remake-split.util';
import { hasEpisodeMarker } from './m3u-vod-detection.util';
import { splitM3uNameTag } from './m3u-name-tag.util';

/**
 * Collapses episode rows into series.
 *
 * On the playlist this was built against, 40,327 rows become 1,953 series
 * with every row placed. That ratio is the whole feature: a viewer browsing
 * a series catalog is looking for a show, not for the 430 rows one show
 * occupies in a flat list.
 *
 * The model is portal-neutral on purpose. Converting it into the shape the
 * shared season components expect is the job of an adapter in the feature
 * library, next to its only consumer — the Xtream episode shape is a UI
 * contract, not a property of an M3U playlist, and keeping it out of here
 * lets this module import contracts only.
 *
 * The pass runs in three stages, one file each: rows accumulate here,
 * `m3u-series-remake-split.util.ts` decides which same-titled accumulators
 * are separate remakes, and `finalize` freezes what survives.
 */

/**
 * Builds the series list from rows already classified as episodes.
 *
 * `playlistId` is part of every key because the parser mints a fresh random
 * id on each import, so nothing about a row is stable across playlists
 * anyway — and two playlists holding the same show are two catalogs, not
 * one, until cross-playlist merging exists.
 */
export function buildM3uSeriesCatalog<T extends M3uArtworkBearing>(
    episodes: readonly T[] | null | undefined,
    playlistId: string
): readonly M3uSeries<T>[] {
    const accumulators = new Map<string, M3uSeriesAccumulator<T>>();

    for (const channel of episodes ?? []) {
        const parsed = parseRow(channel.name);
        if (!parsed) {
            continue;
        }

        const { tag, title } = splitM3uNameTag(parsed.seriesTitle);
        const keys = normalizeTitleKeys(title);
        if (!keys.base) {
            // Nothing identifying survives normalization — a row named only
            // by punctuation or a bare tag. There is no series it could be
            // filed under.
            continue;
        }

        // The tag is IN the key. "TR:MODERN FAMILY" and "DE:MODERN FAMILY"
        // are one show in two dubs; merging them interleaves two audio
        // languages inside a single season and leaves S1E1 ambiguous.
        //
        // The year is NOT in the key, so a yeared title still merges with
        // an unyeared one. Two DIFFERENT stated years are a different
        // matter — remakes — and are separated afterwards, once the whole
        // catalog is known; that cannot be decided one row at a time.
        const baseKey = `${playlistId}\u0000${tag ?? ''}\u0000${keys.base}`;
        const year = keys.trailingYear;
        const key = `${baseKey}\u0000${year ?? ''}`;

        let series = accumulators.get(key);
        if (!series) {
            series = {
                key,
                baseKey,
                title,
                rawTitle: parsed.seriesTitle,
                languageTag: tag,
                yearHint: keys.trailingYear,
                groups: [],
                groupCounts: new Map(),
                seasons: new Map(),
                posterUrl: null,
            };
            accumulators.set(key, series);
        }

        recordGroup(series, channel.group?.title ?? '');
        series.posterUrl ??= channel.tvg?.logo || null;
        series.yearHint ??= keys.trailingYear;

        addEpisode(series, channel, parsed);
    }

    return regroupM3uSeriesByYear(accumulators.values()).map((series) => {
        remintM3uEpisodeIds(series);
        return finalize(series);
    });
}

/**
 * A row classified as an episode whose name carries NO marker at all still
 * exists and still plays. Dropping it would make provider content vanish
 * from the catalog with no trace — worse than the alternative, a
 * one-episode series named after the row. If the parser later learns that
 * spelling, such rows collapse into their real series on the next load.
 *
 * A name that is nothing BUT a marker ("S01E01") is the other case and is
 * still skipped: there is no series name in it to file it under, and taking
 * the marker as the title would produce one phantom series per episode.
 */
function parseRow(name: string | null | undefined): M3uEpisodeParse | null {
    const parsed = parseM3uEpisode(name);
    if (parsed) {
        return parsed;
    }
    if (hasEpisodeMarker(name)) {
        return null;
    }

    return {
        seriesTitle: (name ?? '').trim(),
        seasonNumber: 1,
        episodeNumber: 1,
        hasExplicitSeason: false,
        episodeTitle: null,
    };
}

function recordGroup<T>(series: M3uSeriesAccumulator<T>, title: string): void {
    if (!series.groupCounts.has(title)) {
        series.groups.push(title);
    }
    series.groupCounts.set(title, (series.groupCounts.get(title) ?? 0) + 1);
}

function addEpisode<T extends M3uArtworkBearing>(
    series: M3uSeriesAccumulator<T>,
    channel: T,
    parsed: M3uEpisodeParse
): void {
    const { seasonNumber, episodeNumber } = parsed;
    let season = series.seasons.get(seasonNumber);
    if (!season) {
        season = new Map();
        series.seasons.set(seasonNumber, season);
    }

    const existing = season.get(episodeNumber);
    if (existing) {
        // A duplicate season×episode is the same episode at another
        // quality. Keeping the first and parking the rest is what lets the
        // id be derived from the coordinates rather than from a URL that
        // providers rotate on every refresh.
        season.set(episodeNumber, {
            ...existing,
            alternatives: [...existing.alternatives, channel],
        });
        return;
    }

    season.set(episodeNumber, {
        id: hashM3uId(`${series.key}\u0000${seasonNumber}x${episodeNumber}`),
        seasonNumber,
        episodeNumber,
        title: parsed.episodeTitle,
        channel,
        alternatives: [],
    });
}

function finalize<T extends M3uArtworkBearing>(
    series: M3uSeriesAccumulator<T>
): M3uSeries<T> {
    const seasons = new Map<number, readonly M3uSeriesEpisode<T>[]>();
    let episodeCount = 0;

    for (const number of [...series.seasons.keys()].sort((a, b) => a - b)) {
        const episodes = [...(series.seasons.get(number)?.values() ?? [])].sort(
            (a, b) => a.episodeNumber - b.episodeNumber
        );
        seasons.set(number, episodes);
        episodeCount += episodes.length;
    }

    let primaryGroup = '';
    let best = -1;
    for (const group of series.groups) {
        const count = series.groupCounts.get(group) ?? 0;
        if (count > best) {
            best = count;
            primaryGroup = group;
        }
    }

    return {
        key: series.key,
        id: hashM3uId(series.key),
        title: series.title,
        rawTitle: series.rawTitle,
        languageTag: series.languageTag,
        yearHint: series.yearHint,
        groups: series.groups,
        primaryGroup,
        seasons,
        episodeCount,
        posterUrl: series.posterUrl,
    };
}
