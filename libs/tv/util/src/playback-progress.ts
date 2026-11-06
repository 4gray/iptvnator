import type { Progress, UserData } from './index';

export function isWatched(progress?: Progress): boolean {
    if (!progress) return false;
    if (progress.watched !== undefined) return progress.watched;
    return (
        Number.isFinite(progress.duration) &&
        progress.duration > 0 &&
        Number.isFinite(progress.seconds) &&
        progress.seconds > 0 &&
        progress.duration - progress.seconds <=
            Math.min(progress.duration * 0.05, 300)
    );
}

export function resumePosition(progress?: Progress): number {
    return progress && !isWatched(progress) && Number.isFinite(progress.seconds)
        ? Math.max(0, progress.seconds)
        : 0;
}

export function progressLabel(progress: Progress): string {
    if (progress.item.kind === 'live') return 'Live TV';
    if (isWatched(progress)) return 'Watched';
    const seconds = Number.isFinite(progress.seconds)
        ? Math.max(0, progress.seconds)
        : 0;
    return Number.isFinite(progress.duration) && progress.duration > 0
        ? `${Math.max(0, Math.ceil((progress.duration - seconds) / 60))} min left`
        : `${Math.floor(seconds / 60)} min watched`;
}

/** Manual status preserves the actual viewing position and last-played date. */
export function setWatched(
    data: UserData,
    id: string,
    watched: boolean
): UserData {
    const position = data.positions[id];
    return {
        ...data,
        history: data.history.map((p) =>
            p.item.id === id ? { ...p, watched } : p
        ),
        positions: position
            ? { ...data.positions, [id]: { ...position, watched } }
            : data.positions,
    };
}
