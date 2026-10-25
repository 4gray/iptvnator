import type { Media, UserData } from './index';

export const mediaTitle = (item: Media) =>
    item.kind === 'episode' ? item.seriesTitle || item.title : item.title;

export function withSeriesContext(episode: Media, parent?: Media): Media {
    if (
        episode.kind !== 'episode' ||
        !parent ||
        parent.kind !== 'series' ||
        !parent.title.trim() ||
        episode.parentId !== parent.id ||
        episode.sourceId !== parent.sourceId
    )
        return episode;
    const context = {
        seriesTitle: parent.title,
        seriesYear: parent.year || episode.seriesYear,
        poster: episode.poster || parent.poster,
        backdrop: episode.backdrop || parent.backdrop,
    };
    return Object.entries(context).every(
        ([key, value]) => episode[key as keyof Media] === value
    )
        ? episode
        : { ...episode, ...context };
}

/** Additive repair for historical episodes when their parent becomes available. */
export function recoverSeriesContext(
    data: UserData,
    parents: (Media | undefined)[]
): UserData {
    const known = new Map(
        parents
            .filter((m): m is Media => m?.kind === 'series')
            .map((m) => [m.id, m])
    );
    let changed = false;
    const item = (value: Media) => {
        const next = withSeriesContext(value, known.get(value.parentId ?? ''));
        if (next !== value) changed = true;
        return next;
    };
    const progress = (p: UserData['history'][number]) => {
        const next = item(p.item);
        return next === p.item ? p : { ...p, item: next };
    };
    const history = data.history.map(progress);
    const favorites = data.favorites.map(item);
    const positions = { ...data.positions };
    Object.keys(positions).forEach((key) => {
        positions[key] = progress(positions[key]);
    });
    return changed ? { ...data, history, favorites, positions } : data;
}
