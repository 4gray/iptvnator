import { eq, getTableColumns } from 'drizzle-orm';
import type { DatabaseInstance } from '@iptvnator/shared/database';
import {
    buildPlaylistRow,
    parseAppPlaylist,
    playlistConflictUpdate,
} from '@iptvnator/shared/database/app-playlist';
import { appState, playlists } from '@iptvnator/shared/database/schema';
import type { Playlist as PlaylistRow } from '@iptvnator/shared/database/schema';
import { SERVER_PAYLOAD_FIELDS } from '@iptvnator/shared/interfaces';

export type PlaylistDocument = Record<string, unknown>;

export class PlaylistPayloadMissingError extends Error {
    constructor() {
        super('No stored payload to keep');
        this.name = 'PlaylistPayloadMissingError';
    }
}

export class InvalidPlaylistDocumentError extends Error {
    constructor() {
        super('A playlist document needs an id');
        this.name = 'InvalidPlaylistDocumentError';
    }
}

/** Every column except the M3U payload, for metadata reads. */
function metadataColumns() {
    const { payload, ...columns } = getTableColumns(playlists);
    void payload;
    return columns;
}

const metaColumns = metadataColumns();

/** Playlist documents in the shared `playlists` table, same rows as desktop. */
export class ServerPlaylistRepository {
    constructor(private readonly db: DatabaseInstance) {}

    count(): number {
        return this.db.select({ id: playlists.id }).from(playlists).all()
            .length;
    }

    listMetas(): PlaylistDocument[] {
        return this.db
            .select(metaColumns)
            .from(playlists)
            .all()
            .map((row) =>
                parseAppPlaylist({ ...row, payload: null } as PlaylistRow)
            );
    }

    listAll(): PlaylistDocument[] {
        return this.db
            .select()
            .from(playlists)
            .all()
            .map((row) => parseAppPlaylist(row));
    }

    get(playlistId: string): PlaylistDocument | null {
        const row = this.db
            .select()
            .from(playlists)
            .where(eq(playlists.id, playlistId))
            .get();
        return row ? parseAppPlaylist(row) : null;
    }

    upsert(
        document: PlaylistDocument,
        options: { readonly keepPayload: boolean }
    ): void {
        const next = options.keepPayload
            ? this.withStoredPayload(document)
            : document;
        const row = buildPlaylistRow(next);
        if (!row) {
            throw new InvalidPlaylistDocumentError();
        }

        this.db
            .insert(playlists)
            .values(row)
            .onConflictDoUpdate({
                target: playlists.id,
                set: playlistConflictUpdate(row, next),
            })
            .run();
    }

    delete(playlistId: string): void {
        this.db.delete(playlists).where(eq(playlists.id, playlistId)).run();
    }

    deleteAll(): void {
        this.db.delete(playlists).run();
    }

    getAppState(key: string): string | null {
        return (
            this.db
                .select({ value: appState.value })
                .from(appState)
                .where(eq(appState.key, key))
                .get()?.value ?? null
        );
    }

    setAppState(key: string, value: string): void {
        const updatedAt = new Date().toISOString();
        this.db
            .insert(appState)
            .values({ key, value, updatedAt })
            .onConflictDoUpdate({
                target: appState.key,
                set: { value, updatedAt },
            })
            .run();
    }

    /** Fills the payload fields the client left out from the stored row. */
    private withStoredPayload(document: PlaylistDocument): PlaylistDocument {
        const id = String(document['_id'] ?? '');
        const stored = this.db
            .select({ payload: playlists.payload })
            .from(playlists)
            .where(eq(playlists.id, id))
            .get();
        const parsed = parseStoredPayload(stored?.payload);
        if (!parsed) {
            throw new PlaylistPayloadMissingError();
        }

        const merged: PlaylistDocument = { ...document };
        for (const field of SERVER_PAYLOAD_FIELDS) {
            if (!(field in merged) && field in parsed) {
                merged[field] = parsed[field];
            }
        }
        return merged;
    }
}

function parseStoredPayload(
    payload: string | null | undefined
): PlaylistDocument | null {
    if (!payload) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(payload);
        return parsed && typeof parsed === 'object'
            ? (parsed as PlaylistDocument)
            : null;
    } catch {
        return null;
    }
}
