import express, { Router } from 'express';
import {
    parseHistoryScope,
    parseHistoryOperation,
    type HistoryScope,
} from '@iptvnator/shared/interfaces/history-sync';
import { SqliteHistoryServerStore } from '@iptvnator/shared/database/history-sync';
import { ServerFavoriteService } from './favorites-service';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';
export function createHistoryRouter(storage: ServerStorage): Router {
    const router = Router();
    const sources = new ServerFavoriteService(storage);
    const scope = (id: string): HistoryScope => ({
        ...sources.context(id),
        instanceId: storage.database.instanceId,
    });
    const states = new SqliteHistoryServerStore(
        storage.database.sqlite,
        (address) => {
            const current = scope(address.sourceId);
            if (
                current.instanceId !== address.instanceId ||
                current.sourceIncarnation !== address.sourceIncarnation ||
                current.provider !== address.provider
            )
                throw new StorageRequestError(
                    409,
                    'source_changed',
                    'History source identity changed.'
                );
        }
    );
    router.use('/history', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (req.get('x-iptvnator-instance-id') !== storage.database.instanceId)
            throw new StorageRequestError(
                409,
                'instance_changed',
                'Verify server identity before syncing history.'
            );
        next();
    });
    router.get('/history/sources/:id', (req, res) => {
        const address = scope(req.params.id);
        res.json({ scope: address, state: states.read(address) });
    });
    router.use('/history', express.json({ limit: 64 * 1024 }));
    router.post('/history/operations', (req, res) => {
        let address: HistoryScope;
        let operation: ReturnType<typeof parseHistoryOperation>;
        try {
            address = parseHistoryScope(req.body?.scope);
            operation = parseHistoryOperation(req.body?.operation);
        } catch {
            throw new StorageRequestError(
                400,
                'invalid_history',
                'Invalid history request.'
            );
        }
        try {
            res.json(states.apply(address, operation));
        } catch (error) {
            if (error instanceof StorageRequestError) throw error;
            throw new StorageRequestError(
                409,
                'history_conflict',
                'History operation cannot be applied.'
            );
        }
    });
    return router;
}
