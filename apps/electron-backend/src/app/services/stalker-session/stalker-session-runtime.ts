import {
    databaseWorkerClient,
    type DatabaseWorkerClient,
} from '../database-worker-client';
import { stalkerPlaybackContextService } from '../stalker-playback-context.service';
import { mapRawOperation } from './stalker-operation-adapter';
import { createStalkerSavedCredentialsLoader } from './stalker-saved-credentials';
import {
    StalkerSessionManager,
    type StalkerSessionManagerDependencies,
    type StalkerSessionPlaybackContextPort,
} from './stalker-session-manager';

type StalkerDatabaseWorker = Pick<DatabaseWorkerClient, 'request'>;

export type StalkerSessionRuntimeDependencies = Omit<
    StalkerSessionManagerDependencies,
    'loadSavedCredentials' | 'mapRawOperation' | 'playbackContexts'
> & {
    readonly databaseWorker?: StalkerDatabaseWorker;
    readonly playbackContexts?: StalkerSessionPlaybackContextPort;
};

export function createStalkerPlaylistReader(
    databaseWorker: StalkerDatabaseWorker = databaseWorkerClient
): (playlistRef: string) => Promise<unknown> {
    return (playlistRef) =>
        databaseWorker.request('DB_GET_APP_PLAYLIST', {
            playlistId: playlistRef,
        });
}

export function createStalkerSessionManager(
    dependencies: StalkerSessionRuntimeDependencies = {}
): StalkerSessionManager {
    const {
        databaseWorker = databaseWorkerClient,
        playbackContexts = stalkerPlaybackContextService,
        ...managerDependencies
    } = dependencies;
    return new StalkerSessionManager({
        ...managerDependencies,
        loadSavedCredentials: createStalkerSavedCredentialsLoader(
            createStalkerPlaylistReader(databaseWorker)
        ),
        mapRawOperation,
        playbackContexts,
    });
}

export const stalkerSessionManager = createStalkerSessionManager();
