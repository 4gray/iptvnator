import { formatWithIntl } from '@iptvnator/pipes/date-format';
import {
    formatDurationLabel,
    formatRemainingLabel,
    isPortalPlaybackInProgress,
    type RemainingTimeLabel,
} from '@iptvnator/portal/shared/util';
import {
    PlaybackPositionData,
    XtreamSerieEpisodeInfo,
} from '@iptvnator/shared/interfaces';
import { episodeRuntimeSeconds } from './episode-progress.util';

/**
 * The time part of an episode's meta line: the time left for a started
 * episode, otherwise its runtime. Null when the provider sent neither.
 */
export function episodeTimeLabel(
    info: XtreamSerieEpisodeInfo | undefined,
    position: PlaybackPositionData | undefined
): RemainingTimeLabel | null {
    if (isPortalPlaybackInProgress(position)) {
        const remaining = formatRemainingLabel(position);
        if (remaining) {
            return remaining;
        }
    }
    return formatDurationLabel(episodeRuntimeSeconds(info));
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * "12 Jan" for an air date in the current year, "12 Jan 2019" otherwise.
 * An ISO day ("2019-01-12", the Xtream and TMDB form) is read as a local
 * calendar day, so it never shifts by one west of UTC. Empty when the
 * provider sent nothing parseable.
 */
export function formatEpisodeAirDate(
    releaseDate: string | undefined | null,
    locale: string | undefined | null,
    now: Date = new Date()
): string {
    const value = releaseDate?.trim();
    if (!value) {
        return '';
    }
    const iso = ISO_DAY.exec(value);
    const date = iso
        ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
        : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return formatWithIntl(date, {
        locale,
        day: 'numeric',
        month: 'short',
        ...(date.getFullYear() === now.getFullYear()
            ? {}
            : { year: 'numeric' }),
    });
}
