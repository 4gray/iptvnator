import {
    SERVER_PAYLOAD_FIELDS,
    type ElectronBridgeCountResult,
    type ElectronBridgeResult,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import { ServerApiError, type ServerApiClient } from './server-api-client';

interface CachedDocument {
    readonly etag: string;
    readonly document: Playlist;
}

type ServerApi = Pick<ServerApiClient, 'request' | 'getJson' | 'sendJson'>;

/**
 * `PlaylistDocumentStore` over the server storage API. Full documents are
 * cached by ETag; every read hands out a private copy and remembers its
 * payload objects, so an upsert whose payload is one of them omits it
 * (`keepPayload=1`). `PlaylistsService` builds a new object per mutation,
 * so cached documents are never mutated in place.
 */
export class ServerPlaylistDocumentStore implements PlaylistDocumentStore {
    private readonly cache = new Map<string, CachedDocument>();
    private readonly servedPayloads = new WeakSet<object>();

    constructor(private readonly api: ServerApi) {}

    dbGetAppPlaylists(): Promise<Playlist[]> {
        return this.api.getJson<Playlist[]>('/playlists');
    }

    dbGetAppPlaylistMetas(): Promise<Playlist[]> {
        return this.api.getJson<Playlist[]>('/playlists?view=meta');
    }

    async dbGetAppPlaylist(playlistId: string): Promise<Playlist | null> {
        const cached = this.cache.get(playlistId);
        let response: Response;
        try {
            response = await this.api.request(
                `/playlists/${encodeURIComponent(playlistId)}`,
                cached ? { headers: { 'If-None-Match': cached.etag } } : {}
            );
        } catch (error) {
            if (error instanceof ServerApiError && error.status === 404) {
                this.cache.delete(playlistId);
                return null;
            }
            throw error;
        }

        if (response.status === 304 && cached) {
            return this.serve(cached.document);
        }
        const document = (await response.json()) as Playlist;
        this.remember(playlistId, response, document);
        return this.serve(document);
    }

    async dbUpsertAppPlaylist(
        playlist: Playlist
    ): Promise<ElectronBridgeResult> {
        const path = `/playlists/${encodeURIComponent(playlist._id)}`;
        const keepPayload = this.carriesServedPayload(playlist);
        let response: Response;
        try {
            response = keepPayload
                ? await this.api.sendJson(
                      'PUT',
                      `${path}?keepPayload=1`,
                      withoutPayload(playlist)
                  )
                : await this.api.sendJson('PUT', path, playlist);
        } catch (error) {
            if (!(
                keepPayload &&
                error instanceof ServerApiError &&
                error.code === 'payload_missing'
            )) {
                throw error;
            }
            response = await this.api.sendJson('PUT', path, playlist);
        }
        this.remember(playlist._id, response, playlist);
        return { success: true };
    }

    async dbUpsertAppPlaylists(
        playlists: Playlist[]
    ): Promise<ElectronBridgeCountResult> {
        for (const playlist of playlists) {
            await this.dbUpsertAppPlaylist(playlist);
        }
        return { success: true, count: playlists.length };
    }

    async dbDeletePlaylist(playlistId: string): Promise<ElectronBridgeResult> {
        await this.api.request(`/playlists/${encodeURIComponent(playlistId)}`, {
            method: 'DELETE',
        });
        this.cache.delete(playlistId);
        return { success: true };
    }

    async dbDeleteAllPlaylists(): Promise<ElectronBridgeResult> {
        await this.api.request('/playlists', { method: 'DELETE' });
        this.cache.clear();
        return { success: true };
    }

    async dbGetAppState(key: string): Promise<string | null> {
        const body = await this.api.getJson<{ value: string | null }>(
            `/app-state/${encodeURIComponent(key)}`
        );
        return body.value;
    }

    async dbSetAppState(
        key: string,
        value: string
    ): Promise<ElectronBridgeResult> {
        await this.api.sendJson(
            'PUT',
            `/app-state/${encodeURIComponent(key)}`,
            {
                value,
            }
        );
        return { success: true };
    }

    private remember(id: string, response: Response, document: Playlist): void {
        const etag = response.headers.get('etag');
        if (etag) {
            this.cache.set(id, { etag, document });
        } else {
            this.cache.delete(id);
        }
    }

    private serve(document: Playlist): Playlist {
        const copy = structuredClone(document);
        const record = copy as unknown as Record<string, unknown>;
        for (const field of SERVER_PAYLOAD_FIELDS) {
            const value = record[field];
            if (value && typeof value === 'object') {
                this.servedPayloads.add(value);
            }
        }
        return copy;
    }

    private carriesServedPayload(playlist: Playlist): boolean {
        const record = playlist as unknown as Record<string, unknown>;
        const present = SERVER_PAYLOAD_FIELDS.filter(
            (field) => record[field] !== undefined && record[field] !== null
        );
        return (
            present.length > 0 &&
            present.every(
                (field) =>
                    typeof record[field] === 'object' &&
                    this.servedPayloads.has(record[field] as object)
            )
        );
    }
}

function withoutPayload(playlist: Playlist): Record<string, unknown> {
    const copy = { ...playlist } as Record<string, unknown>;
    for (const field of SERVER_PAYLOAD_FIELDS) {
        delete copy[field];
    }
    return copy;
}
