import {
    applySourceDefinition,
    sameSource,
    sourceFromPlaylist,
    type Playlist,
    type SourceDefinition,
    type SourceServerRequest,
    type SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';

export type SourceRequest = (
    request: SourceServerRequest
) => Promise<SourceServerResponse>;

/** A definition crosses the network; local activity never does. */
export class SyncedPlaylistStore implements PlaylistDocumentStore {
    private tail = Promise.resolve();
    ready = false;
    collectionRevision?: string;
    constructor(
        readonly local: PlaylistDocumentStore,
        private readonly request: SourceRequest,
        private readonly materialize: (
            source: SourceDefinition,
            current?: Playlist
        ) => Promise<Playlist>
    ) {}

    exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.tail.then(operation);
        this.tail = next.then(
            () => undefined,
            () => undefined
        );
        return next;
    }

    async project(
        source: SourceDefinition,
        revision: string
    ): Promise<Playlist> {
        const current = await this.local.dbGetAppPlaylist(source.id);
        const next = await this.materialize(source, current ?? undefined);
        next.sourceSyncBase = source;
        next.sourceSyncRevision = revision;
        await this.local.dbUpsertAppPlaylist(next);
        return next;
    }

    dbGetAppPlaylists = async () => {
        if (!this.ready) throw new Error('SOURCE_SYNC.OFFLINE');
        return this.local.dbGetAppPlaylists();
    };
    dbGetAppPlaylistMetas = async () =>
        (await this.dbGetAppPlaylists()).map((row) => {
            const meta = { ...row };
            delete meta.playlist;
            delete meta.sourceRawM3u;
            return meta;
        });
    dbGetAppPlaylist = (id: string) => this.local.dbGetAppPlaylist(id);
    dbGetAppState = (key: string) => this.local.dbGetAppState(key);
    dbSetAppState = (key: string, value: string) =>
        this.local.dbSetAppState(key, value);

    dbUpsertAppPlaylist = (playlist: Playlist) =>
        this.exclusive(async () => {
            const current = await this.local.dbGetAppPlaylist(playlist._id);
            if (!current && playlist.sourceSyncBase)
                throw new Error('SOURCE_SYNC.CONFLICT');
            const source = sourceFromPlaylist(playlist);
            const baseline = playlist.sourceSyncBase ?? current?.sourceSyncBase;
            let accepted = baseline;
            let revision = current?.sourceSyncRevision;
            if (!baseline || !sameSource(source, baseline)) {
                const response = await this.request({
                    operation: baseline ? 'update' : 'create',
                    id: playlist._id,
                    source,
                    revision: playlist.sourceSyncRevision ?? revision,
                });
                accepted = response.body as SourceDefinition;
                revision = response.etag;
                if (accepted.id !== playlist._id) {
                    const canonical = await this.project(accepted, revision!);
                    return { success: true, playlist: canonical };
                }
            }
            if (!accepted || !revision) throw new Error('SOURCE_SYNC.OFFLINE');
            const next = applySourceDefinition(accepted, playlist);
            next.sourceSyncBase = accepted;
            next.sourceSyncRevision = revision;
            // A local mutation based on an older snapshot cannot revert a remote edit.
            if (
                current?.sourceSyncBase &&
                baseline &&
                sameSource(source, baseline)
            ) {
                Object.assign(
                    next,
                    applySourceDefinition(current.sourceSyncBase, next)
                );
                next.sourceSyncBase = current.sourceSyncBase;
            }
            await this.local.dbUpsertAppPlaylist(next);
            return { success: true, playlist: next };
        });

    dbUpsertAppPlaylists = async (playlists: Playlist[]) => {
        for (const playlist of playlists)
            await this.dbUpsertAppPlaylist(playlist);
        return { success: true, count: playlists.length };
    };
    dbDeletePlaylist = (id: string) =>
        this.exclusive(async () => {
            const current = await this.local.dbGetAppPlaylist(id);
            await this.request({
                operation: 'delete',
                id,
                revision: current?.sourceSyncRevision,
            });
            await this.local.dbDeletePlaylist(id);
            return { success: true };
        });
    dbDeleteAllPlaylists = () =>
        this.exclusive(async () => {
            await this.request({
                operation: 'clear',
                revision: this.collectionRevision,
            });
            await this.local.dbDeleteAllPlaylists();
            return { success: true };
        });
}
