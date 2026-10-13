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

export type PlaylistStorageKind = 'electron' | 'indexeddb';

/** Single place that decides where `PlaylistsService` persists playlists. */
@Injectable({ providedIn: 'root' })
export class PlaylistStorageBackend {
    private readonly runtime = inject(RuntimeCapabilitiesService);

    kind(): PlaylistStorageKind {
        return this.runtime.supportsSqlite ? 'electron' : 'indexeddb';
    }

    /** The document store for `kind()`, or `null` for IndexedDB. */
    documentStore(): PlaylistDocumentStore | null {
        if (this.kind() !== 'electron' || typeof window === 'undefined') {
            return null;
        }
        return (window.electron as PlaylistDocumentStore | undefined) ?? null;
    }
}
