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
    return (await loadFavoritesRuntime(injector)).invoke(raw, method, args);
}
