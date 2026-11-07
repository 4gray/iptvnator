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

export function progressLabel(progress: Progress): string {
    if (progress.item.kind === 'live') return 'Live TV';
    const state = watchState(progress);
    if (state === 'watched') return 'Watched';
    if (state === 'unwatched') return 'Unwatched';
    return Number.isFinite(progress.duration) && progress.duration > 0
        ? `${Math.max(0, Math.ceil((progress.duration - progress.seconds) / 60))} min left`
        : `${Math.floor(progress.seconds / 60)} min watched`;
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
