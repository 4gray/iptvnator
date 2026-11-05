import { inject, Injectable } from '@angular/core';
import type {
    ElectronBridgeApi,
    ElectronBridgeResult,
    Playlist,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';
import {
    sourceConnection,
    sourceConnectionReadFailed,
} from './source-sync/source-connection';

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
    | 'dbUpsertAppPlaylists'
> & {
    /** Browser-only cleanup ownership; callbacks never cross IPC. */
    dbWithSourceCleanup?: <T>(operation: () => Promise<T>) => Promise<T>;
    /** Browser-only conditional delete; the marker is set inside its transaction. */
    dbPruneAppPlaylist?: (
        id: string,
        revision: string | undefined,
        beforeDelete: () => void
    ) => Promise<boolean>;
    /** Local browser-only atomic read/modify/write; callbacks never cross IPC. */
    dbMutateAppPlaylist?: (
        id: string,
        mutate: (current: Playlist | null) => Playlist
    ) => Promise<Playlist>;
    dbUpsertAppPlaylist: (
        playlist: Playlist,
        operationId?: string
    ) => Promise<ElectronBridgeResult & { playlist?: Playlist }>;
} & Partial<
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

export type PlaylistStorageKind = 'electron' | 'indexeddb' | 'server';

/** Single place that decides where `PlaylistsService` persists playlists. */
@Injectable({ providedIn: 'root' })
export class PlaylistStorageBackend {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private serverStore: PlaylistDocumentStore | null = null;
    private finishInitialization!: () => void;
    private readonly initialized = new Promise<void>((resolve) => {
        this.finishInitialization = resolve;
    });
    private readonly deferredStore = new Proxy({} as PlaylistDocumentStore, {
        get:
            (_target, method: keyof PlaylistDocumentStore) =>
            (...args: unknown[]) =>
                this.initialized.then(() => {
                    const store = this.serverStore;
                    if (!store || typeof store[method] !== 'function')
                        throw new Error('SOURCE_SYNC.OFFLINE');
                    return (store[method] as (...values: unknown[]) => unknown)(
                        ...args
                    );
                }),
    });

    installServerStore(store: PlaylistDocumentStore): void {
        this.serverStore = store;
    }
    finishServerInitialization(): void {
        this.finishInitialization();
    }

    useServerStore(store: PlaylistDocumentStore): void {
        this.installServerStore(store);
        this.finishServerInitialization();
    }

    kind(): PlaylistStorageKind {
        if (
            sourceConnection() ||
            sourceConnectionReadFailed() ||
            this.serverStore
        )
            return 'server';
        return this.runtime.supportsSqlite ? 'electron' : 'indexeddb';
    }

    /** The document store for `kind()`, or `null` for IndexedDB. */
    documentStore(): PlaylistDocumentStore | null {
        if (sourceConnection() || sourceConnectionReadFailed())
            return this.deferredStore;
        if (this.serverStore) return this.serverStore;
        return this.localDocumentStore();
    }

    /** The native local projection, independent of the selected authority. */
    localDocumentStore(): PlaylistDocumentStore | null {
        if (!this.runtime.supportsSqlite || typeof window === 'undefined') {
            return null;
        }
        return (window.electron as PlaylistDocumentStore | undefined) ?? null;
    }
}
