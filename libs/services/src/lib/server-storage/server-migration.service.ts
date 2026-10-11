import { inject, Injectable } from '@angular/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { firstValueFrom } from 'rxjs';
import {
    DbStores,
    SERVER_USER_STATE_NAMESPACES,
    type Playlist,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import { planServerMigration } from './server-migration-plan';
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

/** A browser playlist's id on the server, and whether it arrived just now. */
interface MigrationTarget {
    readonly serverId: string;
    readonly uploaded: boolean;
}

/**
 * Moves this browser's playlists to the server. New playlists keep their
 * ids; one the server already has (same id, or same provider source) is
 * merged into the server's copy. The legacy Xtream favorites, history,
 * collections and playback positions follow under the server id, without
 * replacing what a merged playlist already has there. Browser data is
 * never deleted, and the move can run again after a failure.
 */
@Injectable({ providedIn: 'root' })
export class ServerMigrationService {
    private readonly dbService = inject(NgxIndexedDBService);
    private readonly session = inject(ServerStorageSession);
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
        const [browser, server] = await Promise.all([
            this.readBrowserPlaylists(),
            this.session.documentStore.dbGetAppPlaylistMetas(),
        ]);
        const targets = new Map<string, MigrationTarget>();
        let imported = 0;
        let merged = 0;
        let failed = 0;

        for (const step of planServerMigration(browser, server)) {
            if (step.kind === 'merge') {
                merged += 1;
                targets.set(step.browserId, {
                    serverId: step.serverId,
                    uploaded: false,
                });
                continue;
            }
            try {
                await this.session.documentStore.dbUpsertAppPlaylist(
                    step.playlist
                );
                imported += 1;
                targets.set(step.playlist._id, {
                    serverId: step.playlist._id,
                    uploaded: true,
                });
            } catch {
                failed += 1;
            }
        }

        failed += await this.copyXtreamUserData(targets);
        await this.session.userData.hydrate();
        if (failed === 0) {
            // A partial move stays on offer, in Settings → Server.
            this.writeMarker('done');
        }
        return { imported, merged, failed };
    }

    /** Copies the legacy maps; returns how many entries failed. */
    private async copyXtreamUserData(
        targets: ReadonlyMap<string, MigrationTarget>
    ): Promise<number> {
        if (targets.size === 0) {
            return 0;
        }
        const { entries } =
            await this.session.api.getJson<ServerUserStateResponse>(
                '/user-state'
            );
        let failed = 0;
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const legacy = parseMap(readLocal(namespace));
            const onServer = entries[namespace] ?? {};
            for (const [browserId, value] of Object.entries(legacy)) {
                const target = targets.get(browserId);
                if (
                    !target ||
                    (!target.uploaded && target.serverId in onServer)
                ) {
                    continue;
                }
                try {
                    await this.session.api.sendJson(
                        'PUT',
                        `/user-state/${namespace}/${encodeURIComponent(target.serverId)}`,
                        { value }
                    );
                } catch {
                    failed += 1;
                }
            }
        }
        return failed;
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
