import {
    STALKER_SESSION_FAILURE_REASONS,
    type StalkerSessionConnectionDescriptor,
} from '@iptvnator/shared/interfaces';
import type { DatabaseWorkerClient } from '../database-worker-client';
import {
    createStalkerPlaylistReader,
    createStalkerSessionManager,
} from './stalker-session-runtime';

const descriptor: StalkerSessionConnectionDescriptor = {
    connectionMode: 'persisted-open',
    macAddress: '00:1A:79:AA:BB:CC',
    playlistRef: 'playlist-7',
    profilePreset: {
        id: 'mag250-public-5_1-minimal-v1',
        version: 1,
    },
    sourceUrl: 'https://portal.test/c/',
};

describe('Stalker session runtime', () => {
    it('loads a playlist through the non-EPG database worker contract', async () => {
        const request = jest.fn().mockResolvedValue({ _id: 'playlist-7' });
        const readPlaylist = createStalkerPlaylistReader({
            request,
        } as unknown as Pick<DatabaseWorkerClient, 'request'>);

        await expect(readPlaylist('playlist-7')).resolves.toEqual({
            _id: 'playlist-7',
        });
        expect(request).toHaveBeenCalledWith('DB_GET_APP_PLAYLIST', {
            playlistId: 'playlist-7',
        });
    });

    it('consults worker-backed saved credentials before resolving a persisted connection', async () => {
        const request = jest.fn().mockResolvedValue({
            _id: 'playlist-7',
            macAddress: descriptor.macAddress,
            password: 'saved-password',
            portalUrl: descriptor.sourceUrl,
            type: 'stalker',
            username: 'saved-user',
        });
        const resolve = jest.fn().mockResolvedValue({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.EndpointNotFound,
            retryable: false,
            stage: 'resolving',
        });
        const manager = createStalkerSessionManager({
            databaseWorker: {
                request,
            } as unknown as Pick<DatabaseWorkerClient, 'request'>,
            resolver: { resolve },
        });

        await expect(manager.open(1, { descriptor })).resolves.toMatchObject({
            kind: 'failure',
            reason: STALKER_SESSION_FAILURE_REASONS.EndpointNotFound,
        });
        expect(request).toHaveBeenCalledWith('DB_GET_APP_PLAYLIST', {
            playlistId: 'playlist-7',
        });
        expect(resolve).toHaveBeenCalledTimes(1);
    });
});
