import type { Progress, UserData } from './index';
import { isWatched } from './playback-progress';

/** A series contributes its latest episode only, even if older episodes are unfinished. */
export function continueWatching(data: UserData, limit = 8): Progress[] {
    const seen = new Set<string>();
    return data.history
        .map((progress, ordinal) => ({ progress, ordinal }))
        .filter(
            ({ progress: p }) =>
                p.item.kind === 'movie' || p.item.kind === 'episode'
        )
        .sort(
            (a, b) =>
                b.progress.updated - a.progress.updated || a.ordinal - b.ordinal
        )
        .filter(({ progress: p }) => {
            const key = JSON.stringify([
                p.item.sourceId,
                p.item.kind,
                p.item.kind === 'episode'
                    ? p.item.parentId || p.item.id
                    : p.item.id,
            ]);
            if (seen.has(key)) return false;
            seen.add(key);
            return Number.isFinite(p.seconds) && p.seconds > 0 && !isWatched(p);
        })
        .slice(0, limit)
        .map(({ progress }) => progress);
}
