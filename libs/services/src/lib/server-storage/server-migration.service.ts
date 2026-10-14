import { inject, Injectable } from '@angular/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { firstValueFrom } from 'rxjs';
import {
    DbStores,
    getXtreamPendingRestoreStorageKey,
    SERVER_USER_STATE_NAMESPACES,
    type Playlist,
    type ServerUserStateNamespace,
    type ServerUserStateResponse,
    withExplicitStalkerPortalFlag,
} from '@iptvnator/shared/interfaces';
import {
    combineRecentViews,
    combineUserData,
    newestViewsFirst,
    remapChannelReferences,
    retargetUserData,
    unionItems,
} from './server-migration-merge';
import { planServerMigration } from './server-migration-plan';
import { withoutDeleted } from './server-user-data-edit';
import { idMap, preconditionHeaders } from './server-user-data-entries';
import {
    typeLegacyXtreamRefs,
    type XtreamUserData,
} from './server-migration-xtream';
import { ParentalLockService } from '../parental-lock/parental-lock.service';
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
    private readonly parentalLock = inject(ParentalLockService);
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
        // An edit still unsent could land after the combined values below.
        await this.session.userData.flush();
        if (this.session.userData.hasUnsentWrites()) {
            throw new Error('Unsent user data; try again when online');
        }
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

        const onServer = new Set(server.map((playlist) => playlist._id));
        for (const step of planServerMigration(browser, server)) {
            try {
                if (step.kind === 'merge') {
                    // A duplicate of a browser playlist whose upload failed.
                    if (!onServer.has(step.serverId)) {
                        throw new Error('Merge target was not uploaded');
                    }
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
                    // Create-only: another tab or device that moved the
                    // same playlist first keeps its copy, merged into.
                    const created =
                        await this.session.documentStore.dbCreateAppPlaylist(
                            step.playlist
                        );
                    if (created) {
                        imported += 1;
                    } else {
                        await this.mergeDocumentUserData(
                            step.playlist,
                            step.playlist._id
                        );
                        merged += 1;
                    }
                    onServer.add(step.playlist._id);
                    targets.set(step.playlist._id, step.playlist._id);
                }
            } catch {
                failed += 1;
            }
        }

        failed += await this.copyXtreamUserData(targets);
        failed += await this.moveParentalLocks(targets);
        failed += movePendingRestores(targets);
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
            // By stream URL on both sides, so one channel is one favorite.
            favorites: unionItems(
                remapChannelReferences(
                    stored.favorites ?? [],
                    serverChannels,
                    serverChannels
                ),
                remapChannelReferences(
                    favorites,
                    browserChannels,
                    serverChannels
                )
            ),
            // Newest first, one per item: its newest view (the server's on
            // a tie), as the app keeps the list.
            recentlyViewed: unionItems(
                newestViewsFirst(
                    [
                        ...(stored.recentlyViewed ?? []),
                        ...remapChannelReferences(
                            recentlyViewed,
                            browserChannels,
                            serverChannels
                        ),
                    ],
                    'added_at'
                )
            ),
        };
        // Also when only a newer view of an item it has changed.
        if (
            JSON.stringify(next.favorites) !==
                JSON.stringify(stored.favorites ?? []) ||
            JSON.stringify(next.recentlyViewed) !==
                JSON.stringify(stored.recentlyViewed ?? [])
        ) {
            await this.session.documentStore.dbUpsertAppPlaylist(next);
        }
    }

    /**
     * Copies the legacy maps, one write per server entry: each copy's
     * legacy ids are typed first, then the browser copies of one source
     * are combined with each other and with the server's value. Returns
     * how many writes failed.
     */
    private async copyXtreamUserData(
        targets: ReadonlyMap<string, string>
    ): Promise<number> {
        if (targets.size === 0) {
            return 0;
        }
        // Maps keyed by playlist id without a prototype: an id such as
        // `toString` is not mistaken for an entry.
        const { entries, tags } = withoutDeleted(
            await this.session.api.getJson<ServerUserStateResponse>(
                '/user-state'
            ),
            []
        );
        // A map this browser has but cannot read fails the move, so it
        // stays on offer instead of being marked done without it.
        let unreadable = 0;
        const legacy = new Map<
            ServerUserStateNamespace,
            Record<string, unknown>
        >();
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const map = readLegacyMap(namespace);
            if (map) {
                legacy.set(namespace, map);
            } else {
                unreadable += 1;
            }
        }
        const copies = new Map<string, XtreamUserData[]>();
        for (const [browserId, serverId] of targets) {
            const copy: XtreamUserData = {};
            for (const [namespace, map] of legacy) {
                if (browserId in map) {
                    copy[namespace] = retargetUserData(
                        map[browserId],
                        browserId,
                        serverId
                    );
                }
            }
            if (Object.keys(copy).length > 0) {
                copies.set(serverId, [...(copies.get(serverId) ?? []), copy]);
            }
        }

        let failed = unreadable;
        for (const [serverId, browserCopies] of copies) {
            const stored: XtreamUserData = {};
            for (const namespace of SERVER_USER_STATE_NAMESPACES) {
                const value = entries[namespace]?.[serverId];
                if (value !== undefined) {
                    stored[namespace] = value;
                }
            }
            const typed = [stored, ...browserCopies].map(typeLegacyXtreamRefs);
            for (const namespace of SERVER_USER_STATE_NAMESPACES) {
                const value = (
                    namespace === 'xtream-recent-items'
                        ? combineRecentViews
                        : combineUserData
                )(typed.map((copy) => copy[namespace]));
                if (
                    value === undefined ||
                    JSON.stringify(value) === JSON.stringify(stored[namespace])
                ) {
                    continue;
                }
                try {
                    // On the version read above: a device that changed it
                    // meanwhile wins, and the move stays on offer.
                    await this.session.api.sendJson(
                        'PUT',
                        `/user-state/${namespace}/${encodeURIComponent(serverId)}`,
                        { value },
                        tags
                            ? preconditionHeaders(
                                  tags[namespace]?.[serverId] ?? null
                              )
                            : {}
                    );
                } catch {
                    failed += 1;
                }
            }
        }
        return failed;
    }

    /**
     * Parental locks stay in this browser, keyed by playlist id: a playlist
     * merged under another id takes its locks along, or its locked
     * categories would show after the move. Returns how many failed.
     */
    private async moveParentalLocks(
        targets: ReadonlyMap<string, string>
    ): Promise<number> {
        const moving = [...targets].filter(([from, to]) => from !== to);
        // An unreadable lock store reads as empty: keep the move on offer.
        if (
            moving.length > 0 &&
            !(await this.parentalLock.ensureLocksReadable())
        ) {
            return moving.length;
        }
        let failed = 0;
        for (const [browserId, serverId] of targets) {
            const from = this.parentalLock.locksFor(browserId);
            if (
                browserId === serverId ||
                from.xtream.length + from.stalker.length + from.m3u.length === 0
            ) {
                continue;
            }
            const to = this.parentalLock.locksFor(serverId);
            const moved = await this.parentalLock.replacePlaylistLocks(
                serverId,
                {
                    xtream: unionItems(to.xtream, from.xtream),
                    stalker: unionItems(to.stalker, from.stalker),
                    m3u: unionItems(to.m3u, from.m3u),
                }
            );
            if (!moved) {
                failed += 1;
            }
        }
        return failed;
    }

    private async readBrowserPlaylists(): Promise<Playlist[]> {
        const playlists = await firstValueFrom(
            this.dbService.getAll<Playlist>(DbStores.Playlists)
        );
        // A browser that skipped the Stalker metadata migration still has
        // rows without the explicit portal flag.
        return playlists.map(withExplicitStalkerPortalFlag);
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

/**
 * A parked Xtream restore (a browser backup import that could not finish)
 * follows a playlist merged under another id, where it is applied and
 * exported; one the server playlist has parked already wins. Returns how
 * many could not be copied.
 */
function movePendingRestores(targets: ReadonlyMap<string, string>): number {
    let failed = 0;
    for (const [browserId, serverId] of targets) {
        if (browserId === serverId) {
            continue;
        }
        try {
            const parked = localStorage.getItem(
                getXtreamPendingRestoreStorageKey(browserId)
            );
            const target = getXtreamPendingRestoreStorageKey(serverId);
            if (parked !== null && localStorage.getItem(target) === null) {
                localStorage.setItem(target, parked);
            }
        } catch {
            failed += 1;
        }
    }
    return failed;
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

/** A browser map, `{}` when absent, `null` when it cannot be read. */
function readLegacyMap(key: string): Record<string, unknown> | null {
    let value: string | null;
    try {
        value = localStorage.getItem(key);
    } catch {
        return null;
    }
    if (value === null) {
        return idMap();
    }
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? idMap(parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}
