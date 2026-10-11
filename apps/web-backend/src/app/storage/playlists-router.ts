import express, { Router, type Response } from 'express';
import { matchesEtag } from './etag-match';
import {
    deleteAllPlaylistsWithState,
    deletePlaylistWithState,
    type ServerStorage,
} from './server-storage';
import { StorageRequestError } from './storage-route-errors';

export function createPlaylistsRouter(
    storage: ServerStorage,
    maxDocumentBytes: number
): Router {
    const router = Router();
    const json = express.json({ limit: maxDocumentBytes });
    const { playlists, revisions } = storage;

    router.get('/playlists', (req, res) => {
        res.set('Cache-Control', 'no-store').json(
            req.query['view'] === 'meta'
                ? playlists.listMetas()
                : playlists.listAll()
        );
    });

    router.get('/playlists/:id', (req, res) => {
        const id = requirePlaylistId(req.params.id);
        // A cheap existence check first: a tag must never confirm a
        // representation that does not exist.
        if (!playlists.exists(id)) {
            throw new StorageRequestError(
                404,
                'not_found',
                'Playlist not found.'
            );
        }
        const etag = revisions.etag(id);
        withEtag(res, etag);
        if (matchesEtag(req.get('if-none-match'), etag)) {
            res.status(304).end();
            return;
        }
        const document = playlists.get(id);
        if (!document) {
            throw new StorageRequestError(
                404,
                'not_found',
                'Playlist not found.'
            );
        }
        res.json(document);
    });

    router.put('/playlists/:id', json, (req, res) => {
        const id = requirePlaylistId(req.params.id);
        playlists.upsert(
            { ...requireDocument(req.body), _id: id },
            { keepPayload: req.query['keepPayload'] === '1' }
        );
        withEtag(res, revisions.bump(id)).json({ success: true });
    });

    router.delete('/playlists/:id', (req, res) => {
        deletePlaylistWithState(storage, requirePlaylistId(req.params.id));
        res.json({ success: true });
    });

    router.delete('/playlists', (_req, res) => {
        deleteAllPlaylistsWithState(storage);
        res.json({ success: true });
    });

    return router;
}

function withEtag(res: Response, etag: string): Response {
    return res
        .set('ETag', etag)
        .set('Access-Control-Expose-Headers', 'ETag')
        .set('Cache-Control', 'no-cache');
}

/**
 * The row codec trims ids, so an id with surrounding whitespace would be
 * stored under a different key than the one its ETag tracks.
 */
function requirePlaylistId(value: string): string {
    if (!value || value !== value.trim()) {
        throw new StorageRequestError(
            400,
            'invalid_id',
            'A playlist id cannot be empty or start or end with whitespace.'
        );
    }
    return value;
}

function requireDocument(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new StorageRequestError(
            400,
            'invalid_body',
            'Expected a playlist object.'
        );
    }
    return value as Record<string, unknown>;
}
