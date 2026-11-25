import { HISTORY_SYNC_CAPABILITY } from '@iptvnator/shared/interfaces/history-sync';
import { Router } from 'express';
import {
    SERVER_STORAGE_API_VERSION,
    SOURCE_SYNC_CAPABILITY,
    type ServerInstanceInfo,
    type ServerStorageStatusResponse,
} from '@iptvnator/shared/interfaces';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';
import { FAVORITES_SYNC_CAPABILITY } from '@iptvnator/shared/interfaces/favorites-sync';
import { ACTIVITY_SYNC_CAPABILITY } from '@iptvnator/shared/interfaces/activity-sync';
import { isHostedWorkerRequest } from '../hosted-ingress';
import { PROFILES_CAPABILITY } from '@iptvnator/shared/interfaces/profiles';

export function createInstanceRouter(deps: {
    readonly storage: ServerStorage | null;
    readonly accessTokenRequired: boolean;
    readonly cloudflareAccess?: import('../cloudflare-access').CloudflareAccessCheck;
    readonly cloudflareDeviceRegistration?: boolean;
    readonly browserPairing?: boolean;
    readonly workerOnlyStatus?: boolean;
}): Router {
    const router = Router();

    router.get('/instance', async (req, res) => {
        const signedIn =
            isHostedWorkerRequest(req) || (await deps.cloudflareAccess?.(req));
        const body: ServerInstanceInfo = {
            ...(deps.storage
                ? {
                      capabilities: [
                          SOURCE_SYNC_CAPABILITY,
                          ACTIVITY_SYNC_CAPABILITY,
                          FAVORITES_SYNC_CAPABILITY,
                          HISTORY_SYNC_CAPABILITY,
                          ...(deps.browserPairing ? ['browser-pairing-v1'] : []),
                          ...(deps.cloudflareDeviceRegistration ? ['cloudflare-device-v1'] : []),
                          PROFILES_CAPABILITY,
                      ],
                  }
                : {}),
            service: 'iptvnator',
            apiVersion: SERVER_STORAGE_API_VERSION,
            instanceId: deps.storage?.database.instanceId ?? null,
            storage: deps.storage ? 'server' : 'none',
            auth: deps.accessTokenRequired && !signedIn ? 'token' : 'none',
        };
        res.set('Cache-Control', 'no-store').json(body);
    });

    router.get('/instance/status', (req, res) => {
        if (deps.workerOnlyStatus && !isHostedWorkerRequest(req)) {
            res.sendStatus(403);
            return;
        }
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
