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
    if (watchPercent(p) >= 90) return 'watched';
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

/** A revision fences every checkpoint (and retry) from an older player session. */
export function setWatchState(
    data: UserData,
    item: Media,
    action: 'watched' | 'reset',
    now = Date.now()
): UserData {
    const old = data.positions[item.id];
    return recordProgress(data, {
        ...old,
        item,
        seconds: old?.seconds ?? 0,
        duration: old?.duration ?? 0,
        watched: action === 'watched',
        reset: action === 'reset',
        revision: (old?.revision ?? 0) + 1,
        updated: Math.max(now, (old?.updated ?? 0) + 1),
    });
}
