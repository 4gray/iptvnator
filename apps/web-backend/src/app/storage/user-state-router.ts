import express, { Router } from 'express';
import {
    isServerUserStateNamespace,
    type ServerUserStateNamespace,
} from '@iptvnator/shared/interfaces';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

const USER_STATE_BODY_LIMIT = '8mb';
/**
 * Browser app state lives under its own prefix in `app_state`, so a client
 * key can never overwrite a server-owned one such as the instance id.
 */
const CLIENT_APP_STATE_PREFIX = 'client:';

export function createUserStateRouter(storage: ServerStorage): Router {
    const router = Router();
    const json = express.json({ limit: USER_STATE_BODY_LIMIT });

    router.get('/user-state', (_req, res) => {
        res.set('Cache-Control', 'no-store').json({
            entries: storage.userState.all(),
        });
    });

    router.put('/user-state/:namespace/:playlistId', json, (req, res) => {
        const body = req.body as { value?: unknown } | undefined;
        if (!body || typeof body !== 'object' || !('value' in body)) {
            throw new StorageRequestError(
                400,
                'invalid_body',
                'Expected { value }.'
            );
        }
        storage.userState.put(
            requireNamespace(req.params.namespace),
            req.params.playlistId,
            body.value
        );
        res.json({ success: true });
    });

    router.delete('/user-state/:namespace/:playlistId', (req, res) => {
        storage.userState.delete(
            requireNamespace(req.params.namespace),
            req.params.playlistId
        );
        res.json({ success: true });
    });

    router.get('/app-state/:key', (req, res) => {
        res.set('Cache-Control', 'no-store').json({
            value: storage.playlists.getAppState(
                CLIENT_APP_STATE_PREFIX + req.params.key
            ),
        });
    });

    router.put('/app-state/:key', json, (req, res) => {
        const value = (req.body as { value?: unknown } | undefined)?.value;
        if (typeof value !== 'string') {
            throw new StorageRequestError(
                400,
                'invalid_body',
                'Expected { value: string }.'
            );
        }
        storage.playlists.setAppState(
            CLIENT_APP_STATE_PREFIX + req.params.key,
            value
        );
        res.json({ success: true });
    });

    return router;
}

function requireNamespace(value: string): ServerUserStateNamespace {
    if (!isServerUserStateNamespace(value)) {
        throw new StorageRequestError(
            400,
            'invalid_namespace',
            'Unknown user-state namespace.'
        );
    }
    return value;
}
