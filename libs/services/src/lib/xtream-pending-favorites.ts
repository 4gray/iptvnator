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
    playlistId?: string,
    failureMode: 'throw' | 'continue' = 'throw'
): Promise<void> {
    const prefix = getXtreamPendingRestoreStorageKey('');
    let ids: string[];
    try {
        ids = playlistId
            ? [playlistId]
            : Array.from({ length: localStorage.length }, (_, index) =>
                  localStorage.key(index)
              )
                  .filter(
                      (key): key is string =>
                          key !== null && key.startsWith(prefix)
                  )
                  .map((key) => key.slice(prefix.length));
    } catch (error) {
        if (failureMode === 'throw') throw error;
        console.warn('Pending favorites storage could not be read.');
        return;
    }
    for (const id of ids) {
        try {
            const raw = localStorage.getItem(
                getXtreamPendingRestoreStorageKey(id)
            );
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
        } catch (error) {
            if (failureMode === 'throw') throw error;
            // Keep pending state for retry while ordinary reads show healthy data.
            console.warn('A pending favorites conversion could not complete.');
        }
    }
}
