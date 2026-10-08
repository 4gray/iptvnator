import { hashM3uId, normalizeTitleKeys } from '@iptvnator/shared/interfaces';
import { M3uEpisodeParse, parseM3uEpisode } from './m3u-episode-parse.util';
import {
    M3uArtworkBearing,
    M3uSeries,
    M3uSeriesAccumulator,
    M3uSeriesEpisode,
} from './m3u-series-model';
import {
    fileNameOf,
    placeNumberedEpisode,
    placeUnnumberedEpisode,
} from './m3u-series-placement.util';
import {
    mintM3uEpisodeId,
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

    const unnumbered: [M3uSeriesAccumulator<T>, T][] = [];

    for (const channel of episodes ?? []) {
        let parsed = parseRow(channel.name);

        // A standalone row is filed under its own name, whole. Normalizing
        // it would strip the marker and key "Dark Season 1" as "dark": it
        // would then sit at S1E1 of the real series, on top of that
        // series' own first episode.
        let { tag, title } = parsed.standalone
            ? { tag: null, title: parsed.seriesTitle }
            : splitM3uNameTag(parsed.seriesTitle);
        let keys = parsed.standalone
            ? standaloneKeys(title)
            : normalizeTitleKeys(title);
        if (!keys.base) {
            // Nothing identifying survives — a blank name, or one that is
            // only punctuation or a bare tag. The row still plays and the
            // split has already taken it out of the channel list, so it is
            // filed alone, under its name or, failing that, its file name.
            parsed = { ...parsed, standalone: true, unnumbered: true };
            tag = null;
            title = parsed.seriesTitle || fileNameOf(channel.url) || '?';
            keys = standaloneKeys(title);
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
        // Normalization drops bracketed text before it looks for a year, so
        // "Charmed (1998)" and "Charmed (2018)" would arrive as one yearless
        // title and never reach the remake split. The bracketed year is the
        // commonest spelling of all, so it is read here.
        const year = keys.trailingYear ?? bracketedYearOf(title);
        const key = `${baseKey}\u0000${year ?? ''}`;

        let series = accumulators.get(key);
        if (!series) {
            series = {
                key,
                baseKey,
                title,
                rawTitle: parsed.seriesTitle,
                languageTag: tag,
                yearHint: year,
                groups: [],
                groupCounts: new Map(),
                seasons: new Map(),
                posterUrl: null,
            };
            accumulators.set(key, series);
        }

        recordGroup(series, channel.group?.title ?? '');
        series.posterUrl ??= channel.tvg?.logo || null;
        series.yearHint ??= year;

        if (parsed.unnumbered) {
            unnumbered.push([series, channel]);
        } else {
            addEpisode(series, channel, parsed);
        }
    }

    // After every numbered row, so a row with no number never takes the
    // coordinate a real episode states.
    for (const [series, channel] of unnumbered) {
        addUnnumberedEpisode(series, channel);
    }

    return regroupM3uSeriesByYear(accumulators.values()).map((series) => {
        remintM3uEpisodeIds(series);
        return finalize(series);
    });
}

const BRACKETED_YEAR = /[([]\s*((?:19|20)\d{2})\s*[)\]]/;

function bracketedYearOf(title: string): number | null {
    const match = BRACKETED_YEAR.exec(title);
    return match ? Number(match[1]) : null;
}

/** The key of a row filed under its whole name rather than a title. */
function standaloneKeys(title: string): { base: string; trailingYear: null } {
    return { base: `\u0001${title.toLowerCase()}`, trailingYear: null };
}

/**
 * Every row classified as an episode is placed somewhere. The split has
 * already taken it out of the channel list, so a row dropped here would
 * play nowhere — worse than the alternative, a one-episode series named
 * after the row.
 *
 * A name with no marker at all is read as an unnumbered row of the series
 * its name spells. A name with a marker the parser reads no episode from
 * ("Dark Season 1", or a bare "S01E01") is `standalone`: its series is
 * keyed on the whole name, so it cannot land on an episode of the series
 * its title resembles. If the parser later learns the spelling, such rows
 * collapse into their real series on the next load.
 */
function parseRow(
    name: string | null | undefined
): M3uEpisodeParse & { standalone?: boolean; unnumbered?: boolean } {
    const parsed = parseM3uEpisode(name);
    if (parsed) {
        return parsed;
    }

    return {
        seriesTitle: (name ?? '').trim(),
        seasonNumber: 1,
        episodeNumber: 1,
        hasExplicitSeason: false,
        episodeTitle: null,
        unnumbered: true,
        ...(hasEpisodeMarker(name) ? { standalone: true } : {}),
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

    placeNumberedEpisode(season, {
        id: mintM3uEpisodeId(series.key, { seasonNumber, episodeNumber }),
        seasonNumber,
        episodeNumber,
        title: parsed.episodeTitle,
        channel,
        alternatives: [],
    });
}

/**
 * Files a row the parser read no number from.
 *
 * Such rows cannot be told apart by coordinates, and `addEpisode` would
 * park every one after the first as a quality alternative — which nothing
 * plays. Rows that share a name but not a URL are therefore distinct
 * entries of season 1, listed after whatever is already there. The same
 * URL again is the same row and is still parked.
 *
 * The slot is only where the row is listed. Its id is keyed on the file
 * name its URL ends in: the slot moves when the provider reorders the rows
 * or adds a numbered episode, and a watched mark would move with it. The
 * file name is what survives a refresh — the tokens providers rotate sit
 * in the directories before it and in the query.
 */
function addUnnumberedEpisode<T extends M3uArtworkBearing>(
    series: M3uSeriesAccumulator<T>,
    channel: T
): void {
    let season = series.seasons.get(1);
    if (!season) {
        season = new Map();
        series.seasons.set(1, season);
    }

    // The id is minted with every other one, once the series key is final
    // (`remintM3uEpisodeIds`): only then is the row's `rowKey` settled.
    placeUnnumberedEpisode(season, {
        id: 0,
        seasonNumber: 1,
        episodeNumber: 0,
        title: null,
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
