import { Router } from 'express';
import {
    SERVER_STORAGE_API_VERSION,
    type ServerInstanceInfo,
    type ServerStorageStatusResponse,
} from '@iptvnator/shared/interfaces';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

export function createInstanceRouter(deps: {
    readonly storage: ServerStorage | null;
    readonly accessTokenRequired: boolean;
}): Router {
    const router = Router();

    router.get('/instance', (_req, res) => {
        const body: ServerInstanceInfo = {
            service: 'iptvnator',
            apiVersion: SERVER_STORAGE_API_VERSION,
            instanceId: deps.storage?.database.instanceId ?? null,
            storage: deps.storage ? 'server' : 'none',
            auth: deps.accessTokenRequired ? 'token' : 'none',
        };
        res.set('Cache-Control', 'no-store').json(body);
    });

    router.get('/instance/status', (_req, res) => {
        const storage = deps.storage;
        if (!storage) {
            throw new StorageRequestError(
                404,
                'storage_disabled',
                'Server storage is not enabled.'
            );
        }
        const body: ServerStorageStatusResponse = {
            playlists: storage.playlists.count(),
            databaseBytes: storage.database.sizeBytes(),
            databasePath: storage.database.path,
            startedAt: storage.startedAt.toISOString(),
        };
        res.set('Cache-Control', 'no-store').json(body);
    });

    return router;
}
