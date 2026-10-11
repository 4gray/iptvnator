import { inject, Injectable } from '@angular/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { firstValueFrom } from 'rxjs';
import {
    DbStores,
    SERVER_USER_STATE_NAMESPACES,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import { PlaylistBackupService } from '../playlist-backup.service';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerStorageSession } from './server-storage-session';

const MARKER_PREFIX = 'iptvnator-server:migration:';

export interface ServerMigrationPlaylist {
    readonly id: string;
    readonly title: string;
    readonly kind: 'm3u' | 'xtream' | 'stalker';
}

export interface ServerMigrationResult {
    readonly imported: number;
    readonly merged: number;
    readonly failed: number;
}

/**
 * Moves this browser's playlists to the server. An empty server receives
 * them with their ids plus the legacy Xtream user-data maps; a server that
 * already has playlists goes through the backup export/import, whose
 * fingerprints merge duplicates. Browser data is never deleted.
 */
@Injectable({ providedIn: 'root' })
export class ServerMigrationService {
    private readonly dbService = inject(NgxIndexedDBService);
    private readonly session = inject(ServerStorageSession);
    private readonly backend = inject(PlaylistStorageBackend);
    private readonly backup = inject(PlaylistBackupService);
    private readonly instanceId = inject(SERVER_STORAGE_CONFIG).instance
        .instanceId;

    async browserPlaylists(): Promise<ServerMigrationPlaylist[]> {
        const playlists = await this.readBrowserPlaylists();
        return playlists.map((playlist) => ({
            id: playlist._id,
            title: playlist.title,
            kind: playlist.serverUrl
                ? 'xtream'
                : playlist.macAddress
                  ? 'stalker'
                  : 'm3u',
        }));
    }

    /** The startup offer: only for an empty server and an undecided browser. */
    async offerOnStartup(): Promise<ServerMigrationPlaylist[] | null> {
        if (this.readMarker() !== null) {
            return null;
        }
        const playlists = await this.browserPlaylists();
        if (playlists.length === 0) {
            return null;
        }
        const { playlists: serverCount } = await this.session.fetchStatus();
        return serverCount === 0 ? playlists : null;
    }

    browserDataMoved(): boolean {
        return this.readMarker() === 'done';
    }

    skip(): void {
        this.writeMarker('skipped');
    }

    async moveBrowserData(): Promise<ServerMigrationResult> {
        const { playlists: serverCount } = await this.session.fetchStatus();
        const result =
            serverCount === 0
                ? await this.copyWithIds()
                : await this.mergeThroughBackup();
        this.writeMarker('done');
        return result;
    }

    private async copyWithIds(): Promise<ServerMigrationResult> {
        const playlists = await this.readBrowserPlaylists();
        let imported = 0;
        let failed = 0;
        for (const playlist of playlists) {
            try {
                await this.session.documentStore.dbUpsertAppPlaylist(playlist);
                imported += 1;
            } catch {
                failed += 1;
            }
        }
        await this.copyXtreamUserData(new Set(playlists.map((p) => p._id)));
        return { imported, merged: 0, failed };
    }

    private async copyXtreamUserData(
        playlistIds: ReadonlySet<string>
    ): Promise<void> {
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const legacy = parseMap(readLocal(namespace));
            for (const [playlistId, value] of Object.entries(legacy)) {
                if (playlistIds.has(playlistId)) {
                    await this.session.api.sendJson(
                        'PUT',
                        `/user-state/${namespace}/${encodeURIComponent(playlistId)}`,
                        { value }
                    );
                }
            }
        }
        await this.session.userData.hydrate();
    }

    private async mergeThroughBackup(): Promise<ServerMigrationResult> {
        const { json } = await this.backend.runWithBrowserStorage(() =>
            this.backup.exportBackup()
        );
        const summary = await this.backup.importBackup(json);
        return {
            imported: summary.imported,
            merged: summary.merged,
            failed: summary.failed,
        };
    }

    private readBrowserPlaylists(): Promise<Playlist[]> {
        return firstValueFrom(
            this.dbService.getAll<Playlist>(DbStores.Playlists)
        );
    }

    private readMarker(): string | null {
        return readLocal(MARKER_PREFIX + this.instanceId);
    }

    private writeMarker(value: 'done' | 'skipped'): void {
        try {
            localStorage.setItem(MARKER_PREFIX + this.instanceId, value);
        } catch {
            // Without storage the offer simply returns next time.
        }
    }
}

function readLocal(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function parseMap(value: string | null): Record<string, unknown> {
    try {
        const parsed: unknown = value ? JSON.parse(value) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}
