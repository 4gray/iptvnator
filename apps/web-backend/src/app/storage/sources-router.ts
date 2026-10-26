import express, { Router, type Request, type Response } from 'express';
import {
    applySourceDefinition,
    sourceFromPlaylist,
    sourceFingerprint,
    validateSource,
    type Playlist,
    type SourceDefinition,
} from '@iptvnator/shared/interfaces';
import { matchesEtag } from './etag-match';
import {
    deleteAllPlaylistsWithState,
    deletePlaylistWithState,
    type ServerStorage,
} from './server-storage';
import { StorageRequestError } from './storage-route-errors';

export function createSourcesRouter(
    storage: ServerStorage,
    maxDocumentBytes: number
): Router {
    const router = Router();
    const { playlists, revisions } = storage;
    router.use('/sources', (req, _res, next) => {
        const expected = req.get('x-iptvnator-instance-id');
        if (expected && expected !== storage.database.instanceId)
            throw new StorageRequestError(
                409,
                'instance_changed',
                'The server identity changed. Reconnect before editing sources.'
            );
        next();
    });
    const json = express.json({ limit: maxDocumentBytes });
    const sendTag = (res: Response, etag: string) =>
        res.set({
            ETag: etag,
            'Cache-Control': 'no-cache',
            'Access-Control-Expose-Headers': 'ETag',
        });
    const read = (id: string): Playlist => {
        const value = playlists.get(id);
        if (!value)
            throw new StorageRequestError(
                404,
                'not_found',
                'Source not found.'
            );
        return value as unknown as Playlist;
    };
    const check = (req: Request, etag: string) => {
        if (!req.get('if-match'))
            throw new StorageRequestError(
                428,
                'revision_required',
                'A source revision is required.'
            );
        if (req.get('if-match') !== etag)
            throw new StorageRequestError(
                412,
                'source_conflict',
                'The shared library changed. Refresh and retry.'
            );
    };
    const parse = (body: unknown): SourceDefinition => {
        try {
            return validateSource(body);
        } catch {
            throw new StorageRequestError(
                400,
                'invalid_source',
                'Invalid source definition.'
            );
        }
    };
    router.get('/sources', (req, res) => {
        const tag = revisions.collectionEtag();
        sendTag(res, tag);
        if (matchesEtag(req.get('if-none-match'), tag)) {
            res.status(304).end();
            return;
        }
        res.json({
            entries: playlists.listMetas().map((document) => ({
                source: sourceFromPlaylist(
                    document as unknown as Playlist,
                    false
                ),
                revision: revisions.etag(String(document['_id'])),
            })),
        });
    });
    router.get('/sources/:id', (req, res) => {
        const current = read(req.params.id);
        sendTag(res, revisions.etag(req.params.id)).json(
            sourceFromPlaylist(current)
        );
    });
    router.put('/sources/:id', json, (req, res) => {
        const source = parse(req.body);
        if (source.id !== req.params.id)
            throw new StorageRequestError(
                400,
                'invalid_id',
                'Source id mismatch.'
            );
        if (req.get('if-none-match') !== '*')
            throw new StorageRequestError(
                428,
                'revision_required',
                'Create requires If-None-Match.'
            );
        if (playlists.exists(source.id))
            throw new StorageRequestError(
                412,
                'source_conflict',
                'Source already exists.'
            );
        // Synchronous lookup + commit: concurrent imports cannot create duplicates.
        const fingerprint = sourceFingerprint(source);
        const existing = playlists.listMetas().find((entry) => {
            const candidate = sourceFromPlaylist(
                entry as unknown as Playlist,
                false
            );
            if (candidate.kind === 'm3u-text')
                candidate.rawM3u = sourceFromPlaylist(
                    read(candidate.id)
                ).rawM3u;
            return sourceFingerprint(candidate) === fingerprint;
        });
        if (existing) {
            const canonical = sourceFromPlaylist(read(String(existing['_id'])));
            sendTag(res, revisions.etag(canonical.id))
                .status(200)
                .json(canonical);
            return;
        }
        playlists.upsert(
            applySourceDefinition(source) as unknown as Record<string, unknown>,
            { keepPayload: false }
        );
        sendTag(res, revisions.bump(source.id)).status(201).json(source);
    });
    router.patch('/sources/:id', json, (req, res) => {
        const current = read(req.params.id);
        check(req, revisions.etag(req.params.id));
        const source = parse(req.body);
        if (
            source.id !== req.params.id ||
            source.kind !== sourceFromPlaylist(current).kind
        ) {
            throw new StorageRequestError(
                400,
                'invalid_id',
                'Source identity cannot change.'
            );
        }
        playlists.upsert(
            {
                ...applySourceDefinition(source, current),
                ...(current.filePath ? { filePath: current.filePath } : {}),
            } as unknown as Record<string, unknown>,
            { keepPayload: false }
        );
        sendTag(res, revisions.bump(source.id)).json(source);
    });
    router.delete('/sources/:id', (req, res) => {
        read(req.params.id);
        check(req, revisions.etag(req.params.id));
        deletePlaylistWithState(storage, req.params.id);
        res.json({ success: true });
    });
    router.delete('/sources', (req, res) => {
        check(req, revisions.collectionEtag());
        deleteAllPlaylistsWithState(storage);
        res.json({ success: true });
    });
    return router;
}
