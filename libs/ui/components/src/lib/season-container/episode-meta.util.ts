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

/** An i18n key with its parameters, as the meta line's time part. */
export interface EpisodeTimeLabel {
    readonly key: string;
    readonly params: Record<string, number | string>;
}

/** "5:00" / "1:05:00" from a number of seconds. */
function formatClock(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(rest)}`
        : `${minutes}:${pad(rest)}`;
}

/**
 * The time part of an episode's meta line: the time left for a started
 * episode, otherwise its runtime. A started episode whose duration nobody
 * knows (no provider or TMDB runtime, no duration saved with the position)
 * still shows where it resumes. Null when there is nothing to say.
 */
export function episodeTimeLabel(
    info: XtreamSerieEpisodeInfo | undefined,
    position: PlaybackPositionData | undefined
): EpisodeTimeLabel | null {
    if (isPortalPlaybackInProgress(position)) {
        const remaining: RemainingTimeLabel | null =
            formatRemainingLabel(position);
        if (remaining) {
            return remaining;
        }
    }
    const runtime = formatDurationLabel(episodeRuntimeSeconds(info));
    if (runtime) {
        return runtime;
    }
    return position && isPortalPlaybackInProgress(position)
        ? {
              key: 'PORTALS.DETAIL.RESUME_AT',
              params: { time: formatClock(position.positionSeconds) },
          }
        : null;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * A local calendar day from an ISO day, or null when the parts do not name
 * one: the `Date` constructor would otherwise turn a provider's
 * "0000-00-00" placeholder into a day in 1899 and roll "2025-02-31" over
 * into March.
 */
function parseIsoDay(match: RegExpExecArray): Date | null {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
        ? date
        : null;
}

/**
 * "12 Jan" for an air date in the current year, "12 Jan 2019" otherwise.
 * An ISO day ("2019-01-12", the Xtream and TMDB form) is read as a local
 * calendar day, so it never shifts by one west of UTC. Empty when the
 * provider sent nothing parseable, a placeholder or an impossible day.
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
    const date = iso ? parseIsoDay(iso) : new Date(value);
    if (!date || Number.isNaN(date.getTime())) {
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
