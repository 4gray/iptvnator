import { PlaylistRevisions } from './playlist-revisions';
import { openServerDatabase, type ServerDatabase } from './server-database';
import { ServerPlaylistRepository } from './server-playlist-repository';
import { ServerUserStateRepository } from './server-user-state-repository';

export interface ServerStorage {
    readonly database: ServerDatabase;
    readonly playlists: ServerPlaylistRepository;
    readonly userState: ServerUserStateRepository;
    readonly revisions: PlaylistRevisions;
    readonly startedAt: Date;
}

export async function openServerStorage(): Promise<ServerStorage> {
    const database = await openServerDatabase();
    return {
        database,
        playlists: new ServerPlaylistRepository(database.db),
        userState: new ServerUserStateRepository(database.db),
        revisions: new PlaylistRevisions(),
        startedAt: new Date(),
    };
}

/** Deletes a playlist and its user state together, then moves its ETag. */
export function deletePlaylistWithState(
    storage: ServerStorage,
    playlistId: string
): void {
    storage.database.transaction(() => {
        storage.playlists.delete(playlistId);
        storage.userState.deleteForPlaylist(playlistId);
    });
    storage.revisions.bump(playlistId);
}

/** Deletes every playlist and all user state together. */
export function deleteAllPlaylistsWithState(storage: ServerStorage): void {
    storage.database.transaction(() => {
        storage.playlists.deleteAll();
        storage.userState.deleteAll();
    });
    storage.revisions.reset();
}
