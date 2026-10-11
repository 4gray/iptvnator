import {
    SERVER_PAYLOAD_FIELDS,
    SERVER_REPLACED_ETAG_HEADER,
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
 * cached by ETag; every read hands out a private copy and remembers which
 * ETag its payload objects came from, so an upsert whose payload is one of
 * them omits it (`keepPayload=1`). `PlaylistsService` builds a new object
 * per mutation, so cached documents are never mutated in place.
 */
export class ServerPlaylistDocumentStore implements PlaylistDocumentStore {
    private readonly cache = new Map<string, CachedDocument>();
    /** Served payload object → the ETag of the document it came from. */
    private readonly servedPayloads = new WeakMap<object, string>();

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
            return this.serve(cached.document, cached.etag);
        }
        const document = (await response.json()) as Playlist;
        const etag = this.remember(playlistId, response, document);
        return this.serve(document, etag);
    }

    async dbUpsertAppPlaylist(
        playlist: Playlist
    ): Promise<ElectronBridgeResult> {
        const path = `/playlists/${encodeURIComponent(playlist._id)}`;
        const payloadEtag = this.servedPayloadEtag(playlist);
        if (payloadEtag !== null) {
            try {
                const response = await this.api.sendJson(
                    'PUT',
                    `${path}?keepPayload=1`,
                    withoutPayload(playlist)
                );
                // The server kept its stored payload; it is ours only if
                // nothing replaced it since we read it.
                const replaced = response.headers.get(
                    SERVER_REPLACED_ETAG_HEADER
                );
                if (replaced && sameEtag(replaced, payloadEtag)) {
                    this.remember(playlist._id, response, playlist);
                } else {
                    this.cache.delete(playlist._id);
                }
                return { success: true };
            } catch (error) {
                if (!(
                    error instanceof ServerApiError &&
                    error.code === 'payload_missing'
                )) {
                    throw error;
                }
            }
        }
        const response = await this.api.sendJson('PUT', path, playlist);
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

    private remember(
        id: string,
        response: Response,
        document: Playlist
    ): string | null {
        const etag = response.headers.get('etag');
        if (etag) {
            this.cache.set(id, { etag, document });
        } else {
            this.cache.delete(id);
        }
        return etag;
    }

    private serve(document: Playlist, etag: string | null): Playlist {
        const copy = structuredClone(document);
        if (!etag) {
            return copy;
        }
        const record = copy as unknown as Record<string, unknown>;
        for (const field of SERVER_PAYLOAD_FIELDS) {
            const value = record[field];
            if (value && typeof value === 'object') {
                this.servedPayloads.set(value, etag);
            }
        }
        return copy;
    }

    /** The ETag every payload field of `playlist` was served under, if any. */
    private servedPayloadEtag(playlist: Playlist): string | null {
        const record = playlist as unknown as Record<string, unknown>;
        const etags = new Set<string | undefined>();
        for (const field of SERVER_PAYLOAD_FIELDS) {
            const value = record[field];
            if (value === undefined || value === null) {
                continue;
            }
            etags.add(
                typeof value === 'object'
                    ? this.servedPayloads.get(value)
                    : undefined
            );
        }
        const [etag] = etags;
        return etags.size === 1 && etag !== undefined ? etag : null;
    }
}

/** nginx's gzip turns ETags weak; the revision stays the same. */
function sameEtag(left: string, right: string): boolean {
    return left.replace(/^W\//, '') === right.replace(/^W\//, '');
}

function withoutPayload(playlist: Playlist): Record<string, unknown> {
    const copy = { ...playlist } as Record<string, unknown>;
    for (const field of SERVER_PAYLOAD_FIELDS) {
        delete copy[field];
    }
    return copy;
}
