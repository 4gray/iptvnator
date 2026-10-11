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
