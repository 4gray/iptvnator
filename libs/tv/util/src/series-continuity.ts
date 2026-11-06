import type { Media, Progress, UserData } from './index';
import { watchState } from './watch-state';

/** Sort only supplied entries; gaps in episode numbers never imply new identities. */
export function orderedEpisodes(parent: Media, episodes: Media[]): Media[] {
    const seen = new Set<string>();
    const all = episodes
        .filter((e) => {
            if (
                e.kind !== 'episode' ||
                e.sourceId !== parent.sourceId ||
                e.parentId !== parent.id ||
                seen.has(e.id)
            )
                return false;
            seen.add(e.id);
            return true;
        })
        .map((item, ordinal) => ({ item, ordinal }))
        .sort(
            (a, b) =>
                (a.item.season ?? 1) - (b.item.season ?? 1) ||
                (a.item.episode ?? 1) - (b.item.episode ?? 1) ||
                a.ordinal - b.ordinal
        )
        .map((entry) => entry.item);
    return all.some((e) => (e.season ?? 1) > 0)
        ? all.filter((e) => e.season !== 0)
        : all;
}
export interface SeriesAction {
    kind: 'start' | 'resume' | 'next' | 'caught-up';
    item: Media;
    progress?: Progress;
}
export function seriesAction(
    parent: Media,
    episodes: Media[],
    data: UserData
): SeriesAction | undefined {
    const run = orderedEpisodes(parent, episodes);
    if (!run.length) return;
    const active = run
        .map((item, order) => ({
            item,
            order,
            progress: data.positions[item.id],
        }))
        .filter((e) => e.progress && !e.progress.reset)
        .sort(
            (a, b) =>
                b.progress!.updated - a.progress!.updated || b.order - a.order
        );
    const latest = active[0];
    if (!latest)
        return {
            kind: 'start',
            item: run[0],
            progress: data.positions[run[0].id],
        };
    if (watchState(latest.progress) !== 'watched')
        return { kind: 'resume', ...latest };
    const next = run
        .slice(latest.order + 1)
        .find((item) => watchState(data.positions[item.id]) !== 'watched');
    return next
        ? { kind: 'next', item: next, progress: data.positions[next.id] }
        : {
              kind: 'caught-up',
              item: run[0],
              progress: data.positions[run[0].id],
          };
}
export function nextEpisode(
    current: Media,
    episodes: Media[]
): Media | undefined {
    if (current.kind !== 'episode' || !current.parentId) return;
    const run = orderedEpisodes(
        { ...current, id: current.parentId, kind: 'series' },
        episodes
    );
    const index = run.findIndex((e) => e.id === current.id);
    return index < 0 ? undefined : run[index + 1];
}
