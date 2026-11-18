import {
    recordProgress,
    type Media,
    type Progress,
    type UserData,
} from './index';

/** Browser-only equivalent of desktop's rounded 90 percent watched policy. */
export function watchPercent(p?: Progress): number {
    if (p?.reset) return 0;
    if (p?.watched) return 100;
    if (
        !p ||
        !Number.isFinite(p.duration) ||
        p.duration <= 0 ||
        !Number.isFinite(p.seconds)
    )
        return 0;
    const percent = (p.seconds / p.duration) * 100;
    return Math.max(
        0,
        Math.min(100, p.seconds > 10 && percent < 1 ? 1 : Math.round(percent))
    );
}
export function watchState(
    p?: Progress
): 'unwatched' | 'in-progress' | 'watched' {
    if (p?.watched !== false && watchPercent(p) >= 90) return 'watched';
    return !p?.reset && Number.isFinite(p?.seconds) && p!.seconds > 0
        ? 'in-progress'
        : 'unwatched';
}
export const resumeSeconds = (p?: Progress) =>
    watchState(p) === 'in-progress' ? p!.seconds : 0;
export const watchLabel = (p?: Progress) =>
    watchState(p) === 'watched'
        ? 'Watch again'
        : watchState(p) === 'in-progress'
          ? 'Resume'
          : 'Watch now';
export const episodeCode = (item: Media) =>
    `S${item.season ?? 1} · E${item.episode ?? 1}`;

/** A span of viewing time in words: "< 1 min", "42 min", "1 h 12 min". */
export function formatSpan(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 60) return '< 1 min';
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return `${minutes} min`;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** A playback position as a clock: "4:05" or "1:02:09". */
export function formatClock(seconds: number): string {
    const total = Math.max(
        0,
        Math.floor(Number.isFinite(seconds) ? seconds : 0)
    );
    const two = (n: number) => String(n).padStart(2, '0');
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * Watched and remaining time from the same position and duration that draw the
 * progress bar, so the words can never contradict the bar.
 */
export function progressParts(progress: Progress): {
    watched: string;
    left?: string;
} {
    const seconds = Math.max(0, progress.seconds);
    const known = Number.isFinite(progress.duration) && progress.duration > 0;
    return {
        watched: `${formatSpan(seconds)} watched`,
        left: known
            ? `${formatSpan(Math.max(0, progress.duration - seconds))} left`
            : undefined,
    };
}

/** Detail and hero wording for an in-progress title: both halves of the bar. */
export function progressSummary(progress: Progress): string {
    const { watched, left } = progressParts(progress);
    return left ? `${watched} · ${left}` : watched;
}

/** Primary play label; an in-progress title names the time it resumes from. */
export const resumeLabel = (p?: Progress) =>
    watchState(p) === 'in-progress'
        ? `Resume from ${formatClock(p!.seconds)}`
        : watchLabel(p);

export function progressLabel(progress: Progress): string {
    if (progress.item.kind === 'live') return 'Live TV';
    const state = watchState(progress);
    if (state === 'watched') return 'Watched';
    if (state === 'unwatched') return 'Unwatched';
    const { watched, left } = progressParts(progress);
    return left ?? watched;
}

export type WatchAction = 'watched' | 'unwatched' | 'reset';

/** A revision fences every checkpoint (and retry) from an older player session. */
export function setWatchState(
    data: UserData,
    item: Media,
    action: WatchAction,
    now = Date.now()
): UserData {
    const old =
        data.positions[item.id] ??
        data.history.find((p) => p.item.id === item.id);
    if (!old && !data.sources.some((source) => source.id === item.sourceId))
        return data;
    const progress = {
        ...old,
        item: old?.item ?? item,
        seconds: old?.seconds ?? 0,
        duration: old?.duration ?? 0,
        watched: action === 'watched',
        reset: action === 'reset',
        revision: (old?.revision ?? 0) + 1,
        updated: old?.updated ?? now,
    };
    if (!old) return recordProgress(data, progress);
    return {
        ...data,
        history: data.history.map((entry) =>
            entry.item.id === item.id ? progress : entry
        ),
        positions: { ...data.positions, [item.id]: progress },
    };
}
