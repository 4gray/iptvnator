import { firstValueFrom } from 'rxjs';
import { DbStores, type Playlist } from '@iptvnator/shared/interfaces';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import { mutateIndexedDbPlaylist } from './indexeddb-playlist-mutation';

/** Local cache for a selected server; the database name is profile-scoped. */
export function indexedDbDocumentStore(
    db: NgxIndexedDBService,
    profile: string
): PlaylistDocumentStore {
    const upsert = async (playlist: Playlist) => {
        await firstValueFrom(db.update(DbStores.Playlists, playlist));
        return { success: true };
    };
    return {
        dbGetAppPlaylists: () =>
            firstValueFrom(db.getAll<Playlist>(DbStores.Playlists)),
        dbGetAppPlaylist: (id) =>
            firstValueFrom(db.getByID<Playlist>(DbStores.Playlists, id)).then(
                (row) => row ?? null
            ),
        dbUpsertAppPlaylist: upsert,
        dbMutateAppPlaylist: async (id, mutate) => {
            // Let ngx-indexed-db initialize the configured schema first.
            await firstValueFrom(db.getByID<Playlist>(DbStores.Playlists, id));
            return mutateIndexedDbPlaylist(profile, id, mutate);
        },
        dbUpsertAppPlaylists: async (playlists) => {
            for (const playlist of playlists) await upsert(playlist);
            return { success: true, count: playlists.length };
        },
        dbDeletePlaylist: async (id) => {
            await firstValueFrom(db.delete(DbStores.Playlists, id));
            return { success: true };
        },
        dbDeleteAllPlaylists: async () => {
            await firstValueFrom(db.clear(DbStores.Playlists));
            return { success: true };
        },
        dbGetAppState: async (key) =>
            localStorage.getItem(`${profile}:state:${key}`),
        dbSetAppState: async (key, value) => {
            localStorage.setItem(`${profile}:state:${key}`, value);
            return { success: true };
        },
    };
}
