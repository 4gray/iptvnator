import type { Progress, UserData, Media } from './index';
import { watchState } from './watch-state';
import { seriesAction } from './series-continuity';

/** A series contributes its latest episode only, even if older episodes are unfinished. */
export function continueWatching(
    data: UserData,
    limit = 8,
    lists = new Map<string, Media[]>()
): Progress[] {
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
        .map(({ progress, ordinal }) => ({
            progress: data.positions[progress.item.id] ?? progress,
            ordinal,
        }))
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
            return (
                watchState(p) === 'in-progress' ||
                (p.item.kind === 'episode' &&
                    data.sources.some((s) => s.id === p.item.sourceId) &&
                    lists.has(p.item.parentId ?? ''))
            );
        })
        .map(({ progress: p }) => {
            const episodes = data.sources.some((s) => s.id === p.item.sourceId)
                ? lists.get(p.item.parentId ?? '')
                : undefined;
            if (p.item.kind !== 'episode' || !episodes) return p;
            const action = seriesAction(
                { ...p.item, id: p.item.parentId!, kind: 'series' },
                episodes,
                data
            );
            if (
                !action ||
                action.kind === 'caught-up' ||
                (action.kind === 'start' && p.reset)
            )
                return undefined;
            return action.progress && !action.progress.reset
                ? action.progress
                : {
                      item: action.item,
                      seconds: 0,
                      duration: 0,
                      updated: p.updated,
                  };
        })
        .filter((p): p is Progress => !!p)
        .slice(0, limit);
}
