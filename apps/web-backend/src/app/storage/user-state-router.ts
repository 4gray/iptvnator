import express, { Router, type Request, type Response } from 'express';
import {
    isServerUserStateNamespace,
    type ServerUserStateNamespace,
} from '@iptvnator/shared/interfaces';
import type { ExpectedTag } from './server-user-state-repository';
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
        res.set('Cache-Control', 'no-store').json(
            storage.userState.allWithTags()
        );
    });

    const write = (req: Request, res: Response, value: unknown) => {
        const namespace = requireNamespace(String(req.params['namespace']));
        const playlistId = String(req.params['playlistId']);
        // An edit another device queued before the playlist was deleted
        // must not bring its user state back.
        if (value !== undefined && !storage.playlists.exists(playlistId)) {
            throw new StorageRequestError(
                404,
                'playlist_missing',
                'The playlist does not exist.'
            );
        }
        const result = storage.userState.writeIf(
            namespace,
            playlistId,
            value,
            expectedTag(req)
        );
        if ('conflict' in result) {
            res.status(412).json({
                message: 'The entry changed since it was read.',
                status: 412,
                code: 'conflict',
                current: result.conflict,
            });
            return;
        }
        res.json({ success: true, tag: result.tag });
    };

    router.put('/user-state/:namespace/:playlistId', json, (req, res) => {
        const body = req.body as { value?: unknown } | undefined;
        if (!body || typeof body !== 'object' || !('value' in body)) {
            throw new StorageRequestError(
                400,
                'invalid_body',
                'Expected { value }.'
            );
        }
        write(req, res, body.value ?? null);
    });

    router.delete('/user-state/:namespace/:playlistId', (req, res) => {
        write(req, res, undefined);
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

/**
 * `If-Match: "<tag>"` expects that tag, `If-None-Match: *` expects no
 * entry; without either the write is unconditional, as older clients send.
 */
function expectedTag(req: Request): ExpectedTag {
    const ifMatch = req.get('if-match')?.trim();
    if (ifMatch) {
        return ifMatch.replace(/^W\//, '').replace(/^"|"$/g, '');
    }
    return req.get('if-none-match')?.trim() === '*' ? null : undefined;
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
