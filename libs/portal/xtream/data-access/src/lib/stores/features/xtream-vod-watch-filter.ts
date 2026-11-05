import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    PortalWatchStateFilter,
    resolvePortalWatchState,
} from '@iptvnator/portal/shared/util/tokens';

/** Provider movie identity is distinct from SQLite row IDs and episode IDs. */
export function filterXtreamVodByWatchState<
    T extends { xtream_id?: number | string; stream_id?: number | string },
>(
    items: T[],
    filter: PortalWatchStateFilter,
    positions: ReadonlyMap<string, PlaybackPositionData>
): T[] {
    if (filter === null) return items;
    return items.filter((item) => {
        const id = Number(item.xtream_id ?? item.stream_id);
        return (
            Number.isInteger(id) &&
            id > 0 &&
            resolvePortalWatchState(positions.get(`vod_${id}`)) === filter
        );
    });
}
