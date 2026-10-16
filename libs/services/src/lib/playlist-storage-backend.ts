import { inject, Injectable } from '@angular/core';
import type { ElectronBridgeApi } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

/**
 * Whole-playlist document persistence. The Electron preload implements it
 * over the database worker; the self-hosted server storage implements the
 * same contract over HTTP.
 */
export type PlaylistDocumentStore = Pick<
    ElectronBridgeApi,
    | 'dbDeleteAllPlaylists'
    | 'dbDeletePlaylist'
    | 'dbGetAppPlaylist'
    | 'dbGetAppPlaylists'
    | 'dbGetAppState'
    | 'dbSetAppState'
    | 'dbUpsertAppPlaylist'
    | 'dbUpsertAppPlaylists'
> &
    Partial<
        Pick<
            ElectronBridgeApi,
            | 'dbGetAppPlaylistFavoriteChannels'
            | 'dbGetAppPlaylistMetas'
            | 'dbMigrateAppPlaylists'
            | 'dbRecoverLegacyPlaylists'
        >
    >;

/**
 * The server refused a write built on a playlist version another device has
 * replaced since; the write queue runs the mutation again on a fresh read.
 */
export class PlaylistWriteConflict extends Error {
    constructor(readonly playlistId: string) {
        super(`Playlist ${playlistId} changed since it was read.`);
        this.name = 'PlaylistWriteConflict';
    }
}

export type PlaylistStorageKind = 'electron' | 'server' | 'indexeddb';

/** Single place that decides where `PlaylistsService` persists playlists. */
@Injectable({ providedIn: 'root' })
export class PlaylistStorageBackend {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private serverStore: PlaylistDocumentStore | null = null;

    /** Server mode: set once by the server storage session at startup. */
    useServerStore(store: PlaylistDocumentStore): void {
        this.serverStore = store;
    }

    kind(): PlaylistStorageKind {
        if (this.serverStore) {
            return 'server';
        }
        return this.runtime.supportsSqlite ? 'electron' : 'indexeddb';
    }

    /** The document store for `kind()`, or `null` for IndexedDB. */
    documentStore(): PlaylistDocumentStore | null {
        const kind = this.kind();
        if (kind === 'server') {
            return this.serverStore;
        }
        if (kind !== 'electron' || typeof window === 'undefined') {
            return null;
        }
        return (window.electron as PlaylistDocumentStore | undefined) ?? null;
    }
}
