import express, { Router } from 'express';
import {
    parseFavoriteAddress,
    parseFavoriteOperation,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { ServerStorage } from './server-storage';
import { ServerFavoriteService } from './favorites-service';
import { StorageRequestError } from './storage-route-errors';

export function createFavoriteRouter(storage: ServerStorage): Router {
    const router = Router();
    const service = new ServerFavoriteService(storage);
    router.use('/favorites', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (
            req.get('x-iptvnator-instance-id') !== storage.database.instanceId
        ) {
            throw new StorageRequestError(
                409,
                'instance_changed',
                'Verify the server identity before syncing favorite.'
            );
        }
        next();
    });
    router.get('/favorites/sources/:id', (req, res) =>
        res.json(service.context(req.params.id))
    );
    router.get('/favorites/sources/:id/items', (req, res) => {
        const cursor = req.query.cursor;
        if (
            cursor !== undefined &&
            (typeof cursor !== 'string' || cursor.length > 65536)
        ) {
            throw new StorageRequestError(
                400,
                'invalid_cursor',
                'Invalid favorite cursor.'
            );
        }
        const context = service.context(req.params.id);
        res.json(
            service.states.list(
                storage.database.instanceId,
                context,
                cursor as string | undefined
            )
        );
    });
    router.use('/favorites', express.json({ limit: 64 * 1024 }));
    router.post('/favorites/read', (req, res) => {
        const address = parse(() => parseFavoriteAddress(req.body?.address));
        res.json(service.states.read(address));
    });
    router.post('/favorites/operations', (req, res) => {
        const address = parse(() => parseFavoriteAddress(req.body?.address));
        const operation = parse(() =>
            parseFavoriteOperation(req.body?.operation)
        );
        try {
            res.json(service.states.apply(address, operation));
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'Favorite operation ID reused'
            ) {
                throw new StorageRequestError(
                    409,
                    'operation_reused',
                    'Favorite operation ID was already used.'
                );
            }
            throw error;
        }
    });
    return router;
}

function parse<T>(read: () => T): T {
    try {
        return read();
    } catch {
        throw new StorageRequestError(
            400,
            'invalid_favorite',
            'Invalid favorite request.'
        );
    }
}
