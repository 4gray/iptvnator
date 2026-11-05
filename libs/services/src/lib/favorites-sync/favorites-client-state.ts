import {
    emptyFavoriteState,
    parseFavoriteSnapshot,
    type FavoriteLocalRecord,
    type FavoriteSnapshot,
} from '@iptvnator/shared/interfaces/favorites-sync';

export function keepFavoriteImport(
    current: FavoriteLocalRecord | null,
    member: boolean,
    snapshot?: FavoriteSnapshot
): current is FavoriteLocalRecord {
    if (!current) return false;
    if (current.base?.member && !current.pending.length) return true;
    const previous = current.pending[current.pending.length - 1]?.operation;
    if (!previous || previous.member !== member) return false;
    return (
        JSON.stringify(
            previous.snapshot
                ? parseFavoriteSnapshot(previous.snapshot)
                : undefined
        ) ===
        JSON.stringify(snapshot ? parseFavoriteSnapshot(snapshot) : undefined)
    );
}

/** Local choices never authorize delivery or discard parked server intent. */
export function localFavoriteRecord(
    current: FavoriteLocalRecord | null,
    member: boolean,
    snapshot?: FavoriteSnapshot,
    preserveSharedState = false
): FavoriteLocalRecord {
    const state = {
        revision: current?.state.revision ?? 0,
        member,
        ...(snapshot ? { snapshot } : {}),
    };
    return {
        ...current,
        state: preserveSharedState
            ? (current?.state ?? emptyFavoriteState())
            : state,
        local: state,
        base: current?.base ?? emptyFavoriteState(),
        pending: current?.pending ?? [],
    };
}

/** Resolve against the newest known server copy, including retained conflicts. */
export function latestFavoriteBase(
    record: Pick<FavoriteLocalRecord, 'base' | 'conflict'>
) {
    return record.conflict && record.conflict.revision > record.base.revision
        ? record.conflict
        : record.base;
}
