import { inject, Injectable } from '@angular/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { firstValueFrom } from 'rxjs';
import {
    DbStores,
    SERVER_USER_STATE_NAMESPACES,
    type Playlist,
    type ServerUserStateResponse,
} from '@iptvnator/shared/interfaces';
import {
    combineUserData,
    remapChannelReferences,
    retargetUserData,
    unionItems,
} from './server-migration-merge';
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

/**
 * Moves this browser's playlists to the server. New playlists keep their
 * ids; one the server already has (same id, or same provider source) is
 * merged into the server's copy, adding the browser's favorites and
 * history to it. The legacy Xtream favorites, history, collections and
 * playback positions follow under the server id, combined with what is
 * there (`combineUserData`). Browser data is never deleted, and the move
 * can run again after a failure.
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
        const byId = new Map(
            browser.map((playlist) => [playlist._id, playlist])
        );
        /** Browser playlist id → its id on the server. */
        const targets = new Map<string, string>();
        let imported = 0;
        let merged = 0;
        let failed = 0;

        for (const step of planServerMigration(browser, server)) {
            try {
                if (step.kind === 'merge') {
                    const playlist = byId.get(step.browserId);
                    if (playlist) {
                        await this.mergeDocumentUserData(
                            playlist,
                            step.serverId
                        );
                    }
                    merged += 1;
                    targets.set(step.browserId, step.serverId);
                } else {
                    await this.session.documentStore.dbUpsertAppPlaylist(
                        step.playlist
                    );
                    imported += 1;
                    targets.set(step.playlist._id, step.playlist._id);
                }
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

    /** Adds a browser document's favorites and history to the server's. */
    private async mergeDocumentUserData(
        playlist: Playlist,
        serverId: string
    ): Promise<void> {
        const favorites = playlist.favorites ?? [];
        const recentlyViewed = playlist.recentlyViewed ?? [];
        if (favorites.length === 0 && recentlyViewed.length === 0) {
            return;
        }
        const stored =
            await this.session.documentStore.dbGetAppPlaylist(serverId);
        if (!stored) {
            throw new Error('The server playlist disappeared');
        }
        const browserChannels = channelsOf(playlist);
        const serverChannels = channelsOf(stored);
        const next = {
            ...stored,
            favorites: unionItems(
                stored.favorites ?? [],
                remapChannelReferences(
                    favorites,
                    browserChannels,
                    serverChannels
                )
            ),
            recentlyViewed: unionItems(
                stored.recentlyViewed ?? [],
                remapChannelReferences(
                    recentlyViewed,
                    browserChannels,
                    serverChannels
                )
            ),
        };
        if (
            next.favorites.length !== (stored.favorites ?? []).length ||
            next.recentlyViewed.length !== (stored.recentlyViewed ?? []).length
        ) {
            await this.session.documentStore.dbUpsertAppPlaylist(next);
        }
    }

    /**
     * Copies the legacy maps, one write per server entry: browser copies
     * of one source are combined with each other and with the server's
     * value. Returns how many writes failed.
     */
    private async copyXtreamUserData(
        targets: ReadonlyMap<string, string>
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
            const onServer: Record<string, unknown> = entries[namespace] ?? {};
            const incoming = new Map<string, unknown[]>();
            for (const [browserId, value] of Object.entries(
                parseMap(readLocal(namespace))
            )) {
                const serverId = targets.get(browserId);
                if (serverId) {
                    incoming.set(serverId, [
                        ...(incoming.get(serverId) ?? []),
                        retargetUserData(value, browserId, serverId),
                    ]);
                }
            }
            for (const [serverId, values] of incoming) {
                const current = onServer[serverId];
                const value = combineUserData([current, ...values]);
                if (JSON.stringify(value) === JSON.stringify(current)) {
                    continue;
                }
                try {
                    await this.session.api.sendJson(
                        'PUT',
                        `/user-state/${namespace}/${encodeURIComponent(serverId)}`,
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

/** The M3U channels of a full playlist document. */
function channelsOf(playlist: Playlist): { id?: unknown; url?: unknown }[] {
    const items = (playlist as { playlist?: { items?: unknown } }).playlist
        ?.items;
    return Array.isArray(items) ? items : [];
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
