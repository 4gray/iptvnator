import express, { Router } from 'express';
import {
    parseActivityAddress,
    parseActivityOperation,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { ServerStorage } from './server-storage';
import { ServerActivityService } from './activity-service';
import { StorageRequestError } from './storage-route-errors';

export function createActivityRouter(storage: ServerStorage): Router {
    const router = Router();
    const service = new ServerActivityService(storage);
    router.use('/activity', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (
            req.get('x-iptvnator-instance-id') !== storage.database.instanceId
        ) {
            throw new StorageRequestError(
                409,
                'instance_changed',
                'Verify the server identity before syncing activity.'
            );
        }
        next();
    });
    router.get('/activity/sources/:id', (req, res) =>
        res.json(service.context(req.params.id))
    );
    router.get('/activity/sources/:id/items', (req, res) => {
        const cursor = req.query.cursor;
        if (
            cursor !== undefined &&
            (typeof cursor !== 'string' || cursor.length > 65536)
        ) {
            throw new StorageRequestError(
                400,
                'invalid_cursor',
                'Invalid activity cursor.'
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
    router.use('/activity', express.json({ limit: 64 * 1024 }));
    router.post('/activity/read', (req, res) => {
        const address = parse(() => parseActivityAddress(req.body?.address));
        res.json(service.states.read(address));
    });
    router.post('/activity/operations', (req, res) => {
        const address = parse(() => parseActivityAddress(req.body?.address));
        const operation = parse(() =>
            parseActivityOperation(req.body?.operation)
        );
        try {
            res.json(service.states.apply(address, operation));
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === 'Activity operation ID reused'
            ) {
                throw new StorageRequestError(
                    409,
                    'operation_reused',
                    'Activity operation ID was already used.'
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
            'invalid_activity',
            'Invalid activity request.'
        );
    }
}
