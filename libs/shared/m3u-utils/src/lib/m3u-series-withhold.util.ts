import {
    M3uWithheldGroups,
    isM3uGroupWithheld,
} from './m3u-catalog-withhold.util';
import {
    M3uArtworkBearing,
    M3uSeries,
    M3uSeriesEpisode,
} from './m3u-series-model';

/**
 * The series list with every episode of a withheld group taken out.
 *
 * Applied AFTER aggregation rather than to the rows going in: placement
 * and id minting look at the whole series, so building from the unlocked
 * rows alone could move an episode's id — and its watch history — whenever
 * a group is locked or unlocked. Seasons and series left empty disappear;
 * a series whose primary group is withheld is filed under its first group
 * that is not.
 */
export function withholdM3uSeriesGroups<T extends M3uArtworkBearing>(
    series: readonly M3uSeries<T>[],
    withheld: M3uWithheldGroups
): readonly M3uSeries<T>[] {
    if (!withheld) {
        return series;
    }

    const visible = (row: T) => !isM3uGroupWithheld(withheld, row.group?.title);
    const result: M3uSeries<T>[] = [];
    for (const entry of series) {
        const seasons = new Map<number, readonly M3uSeriesEpisode<T>[]>();
        let episodeCount = 0;
        for (const [number, episodes] of entry.seasons) {
            const kept: M3uSeriesEpisode<T>[] = [];
            for (const episode of episodes) {
                const visibleRow = withholdEpisode(episode, visible);
                if (visibleRow) {
                    kept.push(visibleRow);
                }
            }
            if (kept.length > 0) {
                seasons.set(number, kept);
                episodeCount += kept.length;
            }
        }
        if (episodeCount === 0) {
            continue;
        }

        const groups = entry.groups.filter(
            (group) => !isM3uGroupWithheld(withheld, group)
        );
        result.push({
            ...entry,
            groups,
            primaryGroup: groups.includes(entry.primaryGroup)
                ? entry.primaryGroup
                : (groups[0] ?? ''),
            seasons,
            episodeCount,
        });
    }
    return result;
}

/**
 * The episode as the viewer may see it, or null when every copy is
 * withheld. The same stream listed in a locked and an unlocked group is one
 * episode with the other copy in `alternatives`; when the locked copy is
 * the primary, the unlocked one takes its place under the same id, rather
 * than the episode disappearing along with its only playable copy.
 */
function withholdEpisode<T extends M3uArtworkBearing>(
    episode: M3uSeriesEpisode<T>,
    visible: (row: T) => boolean
): M3uSeriesEpisode<T> | null {
    if (visible(episode.channel)) {
        return episode.alternatives.every(visible)
            ? episode
            : {
                  ...episode,
                  alternatives: episode.alternatives.filter(visible),
              };
    }
    const [promoted, ...rest] = episode.alternatives.filter(visible);
    return promoted
        ? { ...episode, channel: promoted, alternatives: rest }
        : null;
}
