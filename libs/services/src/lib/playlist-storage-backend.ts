import { inject, Injectable } from '@angular/core';
import type { ElectronBridgeApi, ElectronBridgeResult, Playlist } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';
import { sourceConnection } from './source-sync/source-connection';

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
> & { dbUpsertAppPlaylist: (playlist: Playlist, operationId?: string) => Promise<ElectronBridgeResult & { playlist?: Playlist }> } &
    Partial<
        Pick<
            ElectronBridgeApi,
            | 'dbGetAppPlaylistFavoriteChannels'
            | 'dbGetAppPlaylistMetas'
            | 'dbMigrateAppPlaylists'
            | 'dbRecoverLegacyPlaylists'
        >
    >;

export type PlaylistStorageKind = 'electron' | 'indexeddb' | 'server';

/** Single place that decides where `PlaylistsService` persists playlists. */
@Injectable({ providedIn: 'root' })
export class PlaylistStorageBackend {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private serverStore: PlaylistDocumentStore | null = null;
    private finishInitialization!: () => void;
    private readonly initialized = new Promise<void>((resolve) => { this.finishInitialization = resolve; });
    private readonly deferredStore = new Proxy({} as PlaylistDocumentStore, {
        get: (_target, method: keyof PlaylistDocumentStore) => (...args: unknown[]) =>
            this.initialized.then(() => {
                const store = this.serverStore;
                if (!store || typeof store[method] !== 'function') throw new Error('SOURCE_SYNC.OFFLINE');
                return (store[method] as (...values: unknown[]) => unknown)(...args);
            }),
    });

    installServerStore(store: PlaylistDocumentStore): void { this.serverStore = store; }
    finishServerInitialization(): void { this.finishInitialization(); }

    kind(): PlaylistStorageKind {
        if (sourceConnection() || this.serverStore) return 'server';
        return this.runtime.supportsSqlite ? 'electron' : 'indexeddb';
    }

    /** The document store for `kind()`, or `null` for IndexedDB. */
    documentStore(): PlaylistDocumentStore | null {
        if (sourceConnection()) return this.deferredStore;
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
