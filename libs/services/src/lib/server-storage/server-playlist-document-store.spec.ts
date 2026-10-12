import type { Playlist } from '@iptvnator/shared/interfaces';
import { ServerApiError } from './server-api-client';
import { ServerPlaylistDocumentStore } from './server-playlist-document-store';

function fakeResponse(status: number, body?: unknown, etag?: string) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: new Headers(etag ? { etag } : {}),
        json: async () => body,
    } as unknown as Response;
}

function putResponse(etag: string, replaced: string) {
    return {
        status: 200,
        ok: true,
        headers: new Headers({ etag, 'x-replaced-etag': replaced }),
        json: async () => ({ success: true }),
    } as unknown as Response;
}

describe('ServerPlaylistDocumentStore', () => {
    const doc = {
        _id: 'p1',
        title: 'Family',
        favorites: [],
        playlist: { header: { raw: '#EXTM3U' }, items: [{ id: 'a' }] },
    } as unknown as Playlist;

    function setup() {
        const api = {
            request: jest.fn(),
            getJson: jest.fn(),
            readJson: jest.fn((response: Response) => response.json()),
            sendJson: jest.fn(),
        };
        return { api, store: new ServerPlaylistDocumentStore(api as never) };
    }

    it('caches by ETag and serves a private copy on 304', async () => {
        const { api, store } = setup();
        api.request
            .mockResolvedValueOnce(fakeResponse(200, doc, 'W/"b.0.1"'))
            .mockResolvedValueOnce(fakeResponse(304));

        const first = await store.dbGetAppPlaylist('p1');
        const second = await store.dbGetAppPlaylist('p1');

        expect(api.request.mock.calls[1][1]).toEqual({
            headers: { 'If-None-Match': 'W/"b.0.1"' },
        });
        expect(second).toEqual(doc);
        expect(second).not.toBe(first);
    });

    it('returns null for an unknown playlist', async () => {
        const { api, store } = setup();
        api.request.mockRejectedValue(
            new ServerApiError(404, 'not_found', 'x')
        );

        await expect(store.dbGetAppPlaylist('zz')).resolves.toBeNull();
    });

    it('omits an unchanged payload and keeps it on the server', async () => {
        const { api, store } = setup();
        api.request.mockResolvedValueOnce(fakeResponse(200, doc, '"b.0.1"'));
        api.sendJson.mockResolvedValue(
            fakeResponse(200, { success: true }, '"b.0.2"')
        );
        const served = await store.dbGetAppPlaylist('p1');
        if (!served) throw new Error('expected a document');

        await store.dbUpsertAppPlaylist({ ...served, favorites: ['a'] });

        const [method, path, body] = api.sendJson.mock.calls[0];
        expect([method, path]).toEqual(['PUT', '/playlists/p1?keepPayload=1']);
        expect(body).toEqual({ _id: 'p1', title: 'Family', favorites: ['a'] });
    });

    it('uploads a new payload in full', async () => {
        const { api, store } = setup();
        api.sendJson.mockResolvedValue(
            fakeResponse(200, { success: true }, '"b.0.1"')
        );

        await store.dbUpsertAppPlaylist(doc);

        expect(api.sendJson.mock.calls[0][1]).toBe('/playlists/p1');
        expect(api.sendJson.mock.calls[0][2]).toBe(doc);
    });

    it('retries in full when the server has no payload to keep', async () => {
        const { api, store } = setup();
        api.request.mockResolvedValueOnce(fakeResponse(200, doc, '"b.0.1"'));
        const served = await store.dbGetAppPlaylist('p1');
        if (!served) throw new Error('expected a document');
        api.sendJson
            .mockRejectedValueOnce(
                new ServerApiError(409, 'payload_missing', 'x')
            )
            .mockResolvedValueOnce(
                fakeResponse(200, { success: true }, '"b.1.1"')
            );

        await store.dbUpsertAppPlaylist(served);

        expect(api.sendJson.mock.calls[1][1]).toBe('/playlists/p1');
        expect(api.sendJson.mock.calls[1][2]).toBe(served);
    });

    describe('after a keepPayload write', () => {
        async function readThenEdit(replaced: string) {
            const { api, store } = setup();
            // nginx gzip weakens the read's ETag.
            api.request.mockResolvedValueOnce(
                fakeResponse(200, doc, 'W/"b.0.1"')
            );
            const served = await store.dbGetAppPlaylist('p1');
            if (!served) throw new Error('expected a document');
            api.sendJson.mockResolvedValueOnce(
                putResponse('"b.0.2"', replaced)
            );
            await store.dbUpsertAppPlaylist({ ...served, favorites: ['a'] });
            api.request.mockResolvedValueOnce(
                fakeResponse(200, doc, '"b.0.3"')
            );
            await store.dbGetAppPlaylist('p1');
            return api.request.mock.calls[1][1];
        }

        it('keeps its copy when it replaced the version it read', async () => {
            await expect(readThenEdit('"b.0.1"')).resolves.toEqual({
                headers: { 'If-None-Match': '"b.0.2"' },
            });
        });

        it('drops its copy when another device wrote in between', async () => {
            // The server kept a newer payload than the one this client has.
            await expect(readThenEdit('"b.0.4"')).resolves.toEqual({});
        });
    });

    it('clears user-data writes before deleting on the server', async () => {
        const order: string[] = [];
        const api = {
            request: jest.fn(async (path: string) => {
                order.push(`DELETE ${path}`);
                return fakeResponse(200, { success: true });
            }),
            getJson: jest.fn(),
            readJson: jest.fn(),
            sendJson: jest.fn(),
        };
        const store = new ServerPlaylistDocumentStore(
            api as never,
            async (playlistId) => void order.push(`discard ${playlistId}`)
        );

        await store.dbDeletePlaylist('p1');
        await store.dbDeleteAllPlaylists();

        expect(order).toEqual([
            'discard p1',
            'DELETE /playlists/p1',
            'discard undefined',
            'DELETE /playlists',
        ]);
    });
});
