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

export type PlaylistStorageKind = 'electron' | 'server' | 'indexeddb';

/** Single place that decides where `PlaylistsService` persists playlists. */
@Injectable({ providedIn: 'root' })
export class PlaylistStorageBackend {
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private serverStore: PlaylistDocumentStore | null = null;
    private browserOverrideDepth = 0;

    /** Server mode: set once by the server storage session at startup. */
    useServerStore(store: PlaylistDocumentStore): void {
        this.serverStore = store;
    }

    usesBrowserStorageOverride(): boolean {
        return this.browserOverrideDepth > 0;
    }

    /**
     * Runs `task` against browser storage although server mode is active.
     * Only the migration export uses it, inside a modal flow.
     */
    async runWithBrowserStorage<T>(task: () => Promise<T>): Promise<T> {
        this.browserOverrideDepth += 1;
        try {
            return await task();
        } finally {
            this.browserOverrideDepth -= 1;
        }
    }

    kind(): PlaylistStorageKind {
        if (this.serverStore && this.browserOverrideDepth === 0) {
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
