import {
    ElectronBridgeApi,
    getXtreamPendingRestoreStorageKey,
    normalizeXtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';

/** Reads must recover older parked favorites without entering a network bootstrap. */
export async function materializePendingXtreamFavorites(
    bridge: Pick<
        ElectronBridgeApi,
        'dbGetPlaylist' | 'dbRestoreXtreamFavorites'
    >,
    playlistId?: string
): Promise<void> {
    const prefix = getXtreamPendingRestoreStorageKey('');
    const ids = playlistId
        ? [playlistId]
        : Array.from({ length: localStorage.length }, (_, index) =>
              localStorage.key(index)
          )
              .filter(
                  (key): key is string => key !== null && key.startsWith(prefix)
              )
              .map((key) => key.slice(prefix.length));
    for (const id of ids) {
        const raw = localStorage.getItem(getXtreamPendingRestoreStorageKey(id));
        if (!raw) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            continue;
        }
        const state = normalizeXtreamPendingRestoreState(parsed);
        if (!state.favorites.length) continue;
        // Old localStorage can outlive deletion of its owning SQLite playlist.
        // Never recreate a playlist or let an orphan block other saved entries.
        const playlist = await bridge.dbGetPlaylist(id);
        if (!playlist || playlist.type !== 'xtream') continue;
        const result = await bridge.dbRestoreXtreamFavorites(
            id,
            state.favorites,
            state.favoritesRestoreId
        );
        if (!result.success)
            throw new Error('Recovering saved favorites failed.');
    }
}
