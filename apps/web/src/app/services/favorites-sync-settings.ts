import { favoriteReferenceKey } from '@iptvnator/shared/interfaces/favorites-sync';
import { DEFAULT_PERSONAL_SCOPE } from '@iptvnator/shared/interfaces/profiles';
import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import type { Playlist } from '@iptvnator/shared/interfaces';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import type { FavoritesPlaylistAdapter } from './favorites-playlist-adapter';
import {
    xtreamFavoriteReference,
    xtreamFavoriteSnapshot,
} from './favorites-reference-adapters';
import type { LocalFavorite } from './favorites-reference-adapters';
export interface FavoritesImportPreview {
    instanceId: string;
    generation: string;
    sources: {
        sourceId: string;
        incarnation: string;
        items: LocalFavorite[];
    }[];
    unresolved: number;
}
export async function previewLocalFavorites(
    client: FavoritesSyncClient,
    raw: IXtreamDataSource,
    adapter: FavoritesPlaylistAdapter,
    sources: Playlist[],
    read: (sourceId: string) => Promise<Playlist>,
    generation: string
): Promise<FavoritesImportPreview> {
    const preview: FavoritesImportPreview = {
        instanceId: client.options.instanceId,
        generation,
        sources: [],
        unresolved: 0,
    };
    // Device favorites are the household's; a profile has nothing to import.
    for (const meta of client.scope === DEFAULT_PERSONAL_SCOPE ? sources : []) {
        const source = await read(meta._id);
        const context = await client.context(meta._id, generation);
        const local = source.serverUrl
            ? {
                  unresolved: 0,
                  items: (await raw.getFavorites(source._id)).map((item) => ({
                      reference: xtreamFavoriteReference(item),
                      snapshot: xtreamFavoriteSnapshot(item),
                      original: '',
                  })),
              }
            : await adapter.local(source);
        const items = new Map<string, LocalFavorite>(
            local.items.map((item) => [
                favoriteReferenceKey(item.reference),
                item,
            ])
        );
        for (const { address, record } of await client.entries(source._id)) {
            if (!record.local) continue;
            const key = favoriteReferenceKey(address.content);
            if (!record.local.member) items.delete(key);
            else
                items.set(key, {
                    reference: address.content,
                    snapshot: record.local.snapshot ?? {},
                    original: '',
                });
        }
        preview.sources.push({
            sourceId: source._id,
            incarnation: context.sourceIncarnation,
            items: [...items.values()],
        });
        preview.unresolved += local.unresolved;
    }
    if (client.options.consent() !== generation)
        throw new Error('Favorite preview expired');
    return preview;
}
export async function importFavoritePreview(
    client: FavoritesSyncClient,
    preview: FavoritesImportPreview
): Promise<number> {
    if (client.scope !== DEFAULT_PERSONAL_SCOPE) return 0;
    let unresolved = preview.unresolved;
    for (const source of preview.sources)
        for (const item of source.items) {
            if (
                client.options.profileActive?.() === false ||
                preview.instanceId !== client.options.instanceId ||
                preview.generation !== client.options.consent()
            )
                throw new Error('Favorite preview expired');
            const context = await client.context(
                source.sourceId,
                preview.generation
            );
            if (context.sourceIncarnation !== source.incarnation) {
                unresolved++;
                continue;
            }
            await client.set(
                source.sourceId,
                item.reference,
                true,
                item.snapshot,
                true
            );
        }
    return unresolved;
}
