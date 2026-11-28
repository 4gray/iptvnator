import { captureHistoryOwner } from '@iptvnator/services/history-events';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { EnvironmentInjector, inject } from '@angular/core';
import { favoritesProfileUsed } from './favorites-consent';
import type { FavoritesPlaylistBridge } from '@iptvnator/services/favorites-events';
export function favoritesPlaylistBridgeFactory(): FavoritesPlaylistBridge {
    const injector = inject(EnvironmentInjector);
    return {
        active: favoritesProfileUsed,
        project: async (playlist) =>
            favoritesProfileUsed()
                ? (await loadFavoritesRuntime(injector)).project(playlist)
                : playlist,
        mutate: async (playlist, transform, persistLocal) =>
            favoritesProfileUsed()
                ? (await loadFavoritesRuntime(injector)).mutate(
                      playlist,
                      transform,
                      persistLocal
                  )
                : null,
    };
}
export async function loadFavoritesRuntime(injector: EnvironmentInjector) {
    const { FavoritesSyncRuntime } = await import('./favorites-sync-runtime');
    return injector.get(FavoritesSyncRuntime);
}
export async function invokeFavorites(
    injector: EnvironmentInjector,
    raw: import('@iptvnator/portal/xtream/data-access').IXtreamDataSource,
    method: string,
    args: unknown[]
) {
    const source =
        method === 'addFavorite' || method === 'removeFavorite'
            ? args[1]
            : undefined;
    const current =
        typeof source === 'string'
            ? captureHistoryOwner(
                  sourceConnection()?.instanceId,
                  source,
                  () => sourceConnection()?.instanceId,
                  'favorites'
              )
            : () => true;
    const runtime = await loadFavoritesRuntime(injector);
    if (!current()) throw new Error('Favorites action ownership changed.');
    return runtime.invoke(raw, method, args);
}
