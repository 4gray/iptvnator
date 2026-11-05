import {
    FavoritesSyncClient,
    IndexedDbFavoriteLocalStore,
    ElectronFavoriteLocalStore,
    favoriteSourceContextsKey,
    favoriteSourceRetirementKey,
} from '@iptvnator/services/favorites-sync';
import { requestSourceServer } from '@iptvnator/services/source-sync';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import type { RuntimeCapabilitiesService } from '@iptvnator/services';
import type { FavoriteSourceContext } from '@iptvnator/shared/interfaces/favorites-sync';
import type { Playlist } from '@iptvnator/shared/interfaces';
import { readFavoritesConsent } from './favorites-consent-state';
import { favoritesEnabled } from './favorites-consent';
import { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
import { FavoritesXtreamAdapter } from './favorites-xtream-adapter';
import { FavoritesM3uCatalog } from './favorites-m3u-catalog';
import { FavoritesLocalOrder } from './favorites-local-order';
export function createFavoritesRuntimeClient(
    capabilities: RuntimeCapabilitiesService,
    readPlaylist: (sourceId: string) => Promise<Playlist>,
    changed: () => void,
    locks: ConstructorParameters<typeof FavoritesXtreamAdapter>[3]
) {
    const instanceId = sourceConnection()?.instanceId;
    const consent = readFavoritesConsent();
    if (!instanceId || !consent || !capabilities.supportsFavoritesStorage)
        throw new Error('Favorite storage unavailable');

    const key = favoriteSourceContextsKey(instanceId);
    const retirementKey = favoriteSourceRetirementKey(instanceId);
    const epoch = localStorage.getItem(retirementKey);
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    const contexts: FavoriteSourceContext[] = Array.isArray(saved)
        ? saved.filter(
              (item) =>
                  item &&
                  typeof item.sourceId === 'string' &&
                  typeof item.sourceIncarnation === 'string' &&
                  ['m3u', 'xtream', 'stalker'].includes(item.provider)
          )
        : [];
    const local = capabilities.isElectron
        ? new ElectronFavoriteLocalStore(instanceId, (request) =>
              window.electron!.favoritesLocalRequest!(request)
          )
        : new IndexedDbFavoriteLocalStore(instanceId);
    const client = new FavoritesSyncClient(local, {
        instanceId,
        profileActive: () =>
            sourceConnection()?.instanceId === instanceId &&
            localStorage.getItem(retirementKey) === epoch,
        deviceId: consent.deviceId,
        contexts,
        request: requestSourceServer,
        consent: () =>
            sourceConnection()?.instanceId === instanceId && favoritesEnabled()
                ? readFavoritesConsent()!.generation
                : null,
        remember: (value) => {
            const serialized = JSON.stringify(value);
            if (
                sourceConnection()?.instanceId !== instanceId ||
                localStorage.getItem(retirementKey) !== epoch
            )
                throw new Error('Favorite profile changed');
            localStorage.setItem(key, serialized);
        },
        changed,
    });
    const catalogs = new FavoritesM3uCatalog(
        (id) => readPlaylist(id),
        (id) => client.contexts.get(id)?.sourceIncarnation
    );
    const playlistAdapter = new FavoritesPlaylistAdapter(
        client,
        favoritesEnabled,
        (source) => catalogs.resolve(source),
        new FavoritesLocalOrder(instanceId, localStorage)
    );
    const xtreamAdapter = new FavoritesXtreamAdapter(
        client,
        favoritesEnabled,
        capabilities.supportsXtreamSqliteDataSource,
        locks
    );

    return { client, playlistAdapter, xtreamAdapter };
}
