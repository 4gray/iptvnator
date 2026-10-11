import express, { Router, type Response } from 'express';
import type { ServerStorage } from './server-storage';
import { StorageRequestError } from './storage-route-errors';

export function createPlaylistsRouter(
    storage: ServerStorage,
    maxDocumentBytes: number
): Router {
    const router = Router();
    const json = express.json({ limit: maxDocumentBytes });
    const { playlists, userState, revisions } = storage;

    router.get('/playlists', (req, res) => {
        res.set('Cache-Control', 'no-store').json(
            req.query['view'] === 'meta'
                ? playlists.listMetas()
                : playlists.listAll()
        );
    });

    router.get('/playlists/:id', (req, res) => {
        const id = req.params.id;
        const etag = revisions.etag(id);
        withEtag(res, etag);
        if (req.get('if-none-match') === etag) {
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
        const id = req.params.id;
        playlists.upsert(
            { ...requireDocument(req.body), _id: id },
            { keepPayload: req.query['keepPayload'] === '1' }
        );
        withEtag(res, revisions.bump(id)).json({ success: true });
    });

    router.delete('/playlists/:id', (req, res) => {
        const id = req.params.id;
        playlists.delete(id);
        userState.deleteForPlaylist(id);
        revisions.bump(id);
        res.json({ success: true });
    });

    router.delete('/playlists', (_req, res) => {
        playlists.deleteAll();
        userState.deleteAll();
        revisions.reset();
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
