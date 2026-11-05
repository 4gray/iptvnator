import {
    SERVER_PAYLOAD_FIELDS,
    SERVER_REPLACED_ETAG_HEADER,
    type ElectronBridgeCountResult,
    type ElectronBridgeResult,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import {
    type PlaylistDocumentStore,
    PlaylistWriteConflict,
} from '../playlist-storage-backend';
import { ServerApiError, type ServerApiClient } from './server-api-client';

/** The version a served copy came from; JSON never sends it. */
const SERVED_VERSION = Symbol('servedVersion');

function servedVersion(playlist: Playlist): string | null {
    const version = (playlist as unknown as Record<symbol, unknown>)[
        SERVED_VERSION
    ];
    return typeof version === 'string' ? version : null;
}

interface CachedDocument {
    readonly etag: string;
    readonly document: Playlist;
}

type ServerApi = Pick<
    ServerApiClient,
    'request' | 'getJson' | 'readJson' | 'sendJson'
>;

/**
 * `PlaylistDocumentStore` over the server storage API. Full documents are
 * cached by ETag; every read hands out a private copy and remembers which
 * ETag its payload objects came from, so an upsert whose payload is one of
 * them omits it (`keepPayload=1`). `PlaylistsService` builds a new object
 * per mutation, so cached documents are never mutated in place.
 */
export class ServerPlaylistDocumentStore implements PlaylistDocumentStore {
    private readonly cache = new Map<string, CachedDocument>();
    /** `id|version` a write was refused on (another device wrote since). */
    private readonly refused = new Set<string>();
    /** Served payload object → the ETag of the document it came from. */
    private readonly servedPayloads = new WeakMap<object, string>();

    constructor(
        private readonly api: ServerApi,
        /**
         * Runs the server delete of a playlist (without an id, of every
         * playlist), so user-data writes cannot land after it.
         */
        private readonly deleting: (
            playlistId: string | undefined,
            remove: () => Promise<unknown>
        ) => Promise<void> = async (_, remove) => void (await remove())
    ) {}

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
        const document = await this.api.readJson<Playlist>(response);
        const etag = this.remember(playlistId, response, document);
        return this.serve(document, etag);
    }

    /** A mutation: built on the version it read, refused if it changed. */
    dbUpsertAppPlaylist(playlist: Playlist): Promise<ElectronBridgeResult> {
        return this.upsert(playlist, true);
    }

    /** Imports and migrations: written as they are, outside any retry. */
    async dbUpsertAppPlaylists(
        playlists: Playlist[]
    ): Promise<ElectronBridgeCountResult> {
        for (const playlist of playlists) {
            await this.upsert(playlist, false);
        }
        return { success: true, count: playlists.length };
    }

    async dbDeletePlaylist(playlistId: string): Promise<ElectronBridgeResult> {
        await this.deleting(playlistId, () =>
            this.api.request(`/playlists/${encodeURIComponent(playlistId)}`, {
                method: 'DELETE',
            })
        );
        this.cache.delete(playlistId);
        return { success: true };
    }

    async dbDeleteAllPlaylists(): Promise<ElectronBridgeResult> {
        await this.deleting(undefined, () =>
            this.api.request('/playlists', { method: 'DELETE' })
        );
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

    private async upsert(
        playlist: Playlist,
        conditional: boolean
    ): Promise<ElectronBridgeResult> {
        const id = playlist?._id;
        if (!id) {
            // A mutation that ran after its playlist was deleted.
            throw new Error('A playlist without an id cannot be stored.');
        }
        const path = `/playlists/${encodeURIComponent(id)}`;
        const payloadEtag = this.servedPayloadEtag(playlist);
        // The version it was read at: of its payload, else of the copy it
        // was built from (portal documents have no payload). A retry on the
        // same copy, not read again after a refusal, writes as before.
        const read = payloadEtag ?? servedVersion(playlist);
        const headers: Record<string, string> =
            conditional && read && !this.refused.has(`${id}|${read}`)
                ? { 'If-Match': read }
                : {};
        try {
            if (payloadEtag !== null) {
                const response = await this.keepPayload(
                    playlist,
                    payloadEtag,
                    headers
                );
                if (response) {
                    return { success: true };
                }
            }
            const response = await this.api.sendJson(
                'PUT',
                path,
                playlist,
                payloadEtag === null ? headers : {}
            );
            this.remember(id, response, playlist);
            return { success: true };
        } catch (error) {
            if (error instanceof ServerApiError && error.status === 412) {
                this.refused.add(`${id}|${read}`);
                this.cache.delete(id);
                throw new PlaylistWriteConflict(id);
            }
            throw error;
        }
    }

    /**
     * A create-only upload (the move from browser storage): false when the
     * server has a playlist with that id already, uploaded meanwhile by
     * another tab or device, which the caller merges into instead.
     */
    async dbCreateAppPlaylist(playlist: Playlist): Promise<boolean> {
        try {
            const response = await this.api.sendJson(
                'PUT',
                `/playlists/${encodeURIComponent(playlist._id)}`,
                playlist,
                { 'If-None-Match': '*' }
            );
            this.remember(playlist._id, response, playlist);
            return true;
        } catch (error) {
            if (error instanceof ServerApiError && error.status === 412) {
                return false;
            }
            throw error;
        }
    }

    /** `null` when the server has no payload to keep (write it in full). */
    private async keepPayload(
        playlist: Playlist,
        payloadEtag: string,
        headers: Record<string, string>
    ): Promise<Response | null> {
        let response: Response;
        try {
            response = await this.api.sendJson(
                'PUT',
                `/playlists/${encodeURIComponent(playlist._id)}?keepPayload=1`,
                withoutPayload(playlist),
                headers
            );
        } catch (error) {
            if (
                error instanceof ServerApiError &&
                error.code === 'payload_missing'
            ) {
                return null;
            }
            throw error;
        }
        // The server kept its stored payload; it is ours only if nothing
        // replaced it since we read it.
        const replaced = response.headers.get(SERVER_REPLACED_ETAG_HEADER);
        if (replaced && sameEtag(replaced, payloadEtag)) {
            this.remember(playlist._id, response, playlist);
        } else {
            this.cache.delete(playlist._id);
        }
        return response;
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
        // Spreads copy it along, so a mutation built on this copy names it.
        (copy as unknown as Record<symbol, string>)[SERVED_VERSION] = etag;
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
