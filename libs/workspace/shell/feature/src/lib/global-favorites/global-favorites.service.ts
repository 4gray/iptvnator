/**
 * GlobalFavoritesService
 *
 * Aggregates live TV favorites from all three playlist source types:
 * - M3U   – channels whose URL/id is listed in playlist.favorites[]
 * - Xtream – rows in the `favorites` DB table where content.type = 'live'
 * - Stalker – items in playlist.favorites[] that have a `cmd` (live channels)
 *             and do NOT have movie_id / series_id
 *
 * Also handles reordering: persists position for Xtream rows via IPC.
 * For M3U and Stalker the list order is managed in the app_state table
 * as a JSON array of UIDs (keyed by GLOBAL_FAVORITES_ORDER_KEY).
 */
import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { firstValueFrom, map } from 'rxjs';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import {
    Channel,
    Playlist,
    PlaylistMeta,
    StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import {
    buildFavoriteUid,
    UnifiedFavoriteChannel,
} from '@iptvnator/portal/shared/util';

const GLOBAL_FAVORITES_ORDER_KEY = 'global-favorites-channel-order-v1';

interface XtreamGlobalFavoriteRow {
    readonly added_at?: string | null;
    readonly id: number;
    readonly playlist_id: string;
    readonly playlist_name: string;
    readonly position?: number | null;
    readonly poster_url?: string | null;
    readonly title: string;
    readonly xtream_id: number;
}

type PlaylistWithChannels = Playlist & {
    readonly playlist?: {
        readonly items?: Channel[];
    };
};

function isStalkerFavoriteItem(
    value: string | StalkerPortalItem
): value is StalkerPortalItem {
    return typeof value !== 'string';
}

@Injectable({ providedIn: 'root' })
export class GlobalFavoritesService {
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly translate = inject(TranslateService);

    /**
     * Fetch and merge live TV favorites from all source types.
     * The returned list is sorted by persisted position first,
     * then by addedAt descending for items without a position.
     */
    async getUnifiedLiveFavorites(): Promise<UnifiedFavoriteChannel[]> {
        const [m3uItems, xtreamItems, stalkerItems, savedOrder] =
            await Promise.all([
                this.getM3uFavorites(),
                this.getXtreamLiveFavorites(),
                this.getStalkerLiveFavorites(),
                this.getSavedOrder(),
            ]);

        const all = [...m3uItems, ...xtreamItems, ...stalkerItems];

        return this.applyOrder(all, savedOrder);
    }

    /**
     * Remove a channel from its source playlist's favorites.
     * Works for all three source types (M3U, Xtream, Stalker).
     */
    async removeFavorite(channel: UnifiedFavoriteChannel): Promise<void> {
        switch (channel.sourceType) {
            case 'm3u': {
                const playlist = await firstValueFrom(
                    this.playlistsService.getPlaylistById(channel.playlistId)
                );
                const currentFavs = (playlist.favorites as string[]) ?? [];
                const filtered = currentFavs.filter(
                    (f) => f !== channel.streamUrl
                );
                await firstValueFrom(
                    this.playlistsService.setFavorites(
                        channel.playlistId,
                        filtered
                    )
                );
                break;
            }
            case 'xtream': {
                if (window.electron && channel.contentId != null) {
                    await window.electron.dbRemoveFavorite(
                        channel.contentId,
                        channel.playlistId
                    );
                }
                break;
            }
            case 'stalker': {
                const sourceItemId = channel.uid.split('::')[2];
                await firstValueFrom(
                    this.playlistsService.removeFromPortalFavorites(
                        channel.playlistId,
                        sourceItemId
                    )
                );
                break;
            }
        }
    }

    /**
     * Persist the new display order.
     * For Xtream items update the DB position column.
     * For all items, persist the UID order in app_state.
     */
    async reorder(channels: UnifiedFavoriteChannel[]): Promise<void> {
        const uidOrder = channels.map((ch) => ch.uid);

        // Persist xtream positions to DB
        const xtreamUpdates = channels
            .filter(
                (
                    ch
                ): ch is UnifiedFavoriteChannel & { contentId: number } =>
                    ch.sourceType === 'xtream' && ch.contentId != null
            )
            .map((ch, index) => ({
                content_id: ch.contentId,
                position: index,
            }));

        await Promise.all([
            xtreamUpdates.length > 0 && window.electron
                ? window.electron.dbReorderGlobalFavorites(xtreamUpdates)
                : Promise.resolve(),
            this.saveOrder(uidOrder),
        ]);
    }

    // ─── Private helpers ───────────────────────────────────────────

    private async getM3uFavorites(): Promise<UnifiedFavoriteChannel[]> {
        const allMeta = await firstValueFrom(
            this.store
                .select(selectAllPlaylistsMeta)
                .pipe(map((metas) => metas as PlaylistMeta[]))
        );
        const m3uPlaylists = allMeta.filter(
            (p) => p._id && !p.serverUrl && !p.macAddress
        );

        const results: UnifiedFavoriteChannel[] = [];

        for (const meta of m3uPlaylists) {
            if (!meta.favorites?.length) continue;
            const favoriteIds = new Set(
                (meta.favorites as string[]).map(String)
            );

            // Load full playlist to access channel items
            let playlist: PlaylistWithChannels | undefined;
            try {
                playlist = (await firstValueFrom(
                    this.playlistsService.getPlaylistById(meta._id)
                )) as PlaylistWithChannels | undefined;
            } catch {
                continue;
            }

            const items = playlist?.playlist?.items ?? [];
            for (const ch of items) {
                if (favoriteIds.has(ch.id) || favoriteIds.has(ch.url)) {
                    const sourceItemId = ch.url || ch.id;
                    results.push({
                        uid: buildFavoriteUid('m3u', meta._id, sourceItemId),
                        name: ch.name,
                        logo: ch.tvg?.logo ?? null,
                        sourceType: 'm3u',
                        playlistId: meta._id,
                        playlistName: meta.title || meta.filename || 'M3U',
                        streamUrl: ch.url,
                        tvgId: ch.tvg?.id || ch.tvg?.name || ch.name,
                        addedAt: new Date(0).toISOString(),
                        position: 0,
                    });
                }
            }
        }

        return results;
    }

    private async getXtreamLiveFavorites(): Promise<UnifiedFavoriteChannel[]> {
        if (!window.electron) return [];

        let items: XtreamGlobalFavoriteRow[] = [];
        try {
            items =
                (await this.dbService.getGlobalFavorites()) as XtreamGlobalFavoriteRow[];
        } catch {
            return [];
        }

        // getGlobalFavorites now only returns type='live'
        return items.map((item) => ({
            uid: buildFavoriteUid('xtream', item.playlist_id, item.xtream_id),
            name: item.title,
            logo: item.poster_url ?? null,
            sourceType: 'xtream' as const,
            playlistId: item.playlist_id,
            playlistName: item.playlist_name,
            xtreamId: item.xtream_id,
            tvgId: String(item.xtream_id),
            addedAt: item.added_at ?? new Date(0).toISOString(),
            position: item.position ?? 0,
            contentId: item.id,
        }));
    }

    private async getStalkerLiveFavorites(): Promise<UnifiedFavoriteChannel[]> {
        const allMeta = await firstValueFrom(
            this.store
                .select(selectAllPlaylistsMeta)
                .pipe(map((metas) => metas as PlaylistMeta[]))
        );

        const stalkerPlaylists = allMeta.filter((p) => p._id && p.macAddress);

        const results: UnifiedFavoriteChannel[] = [];

        for (const meta of stalkerPlaylists) {
            if (!meta.favorites?.length) continue;

            // Fetch full playlist to get credentials
            let playlist: Playlist | undefined;
            try {
                playlist = (await firstValueFrom(
                    this.playlistsService.getPlaylistById(meta._id)
                )) as Playlist | undefined;
            } catch {
                continue;
            }

            const favorites = Array.isArray(playlist?.favorites)
                ? playlist.favorites.filter(isStalkerFavoriteItem)
                : [];

            for (const fav of favorites) {
                // Live channels: have a cmd, no movie_id / series_id
                const isLive =
                    fav.cmd &&
                    !fav.movie_id &&
                    !fav.series_id &&
                    (fav.stream_type === 'live' ||
                        fav.category_id === 'itv' ||
                        (!fav.stream_type && !fav.series_id && !fav.movie_id));
                if (!isLive) continue;

                const streamId = fav.stream_id ?? fav.id;
                results.push({
                    uid: buildFavoriteUid('stalker', meta._id, streamId),
                    name:
                        fav.o_name ||
                        fav.name ||
                        this.translate.instant(
                            'WORKSPACE.GLOBAL_FAVORITES.UNKNOWN_CHANNEL'
                        ),
                    logo: fav.logo ?? fav.cover ?? null,
                    sourceType: 'stalker' as const,
                    playlistId: meta._id,
                    playlistName:
                        meta.title ||
                        meta.filename ||
                        this.translate.instant(
                            'WORKSPACE.DASHBOARD.STALKER_PORTAL'
                        ),
                    stalkerCmd: fav.cmd,
                    stalkerPortalUrl: playlist.portalUrl ?? playlist.url,
                    stalkerMacAddress: playlist.macAddress,
                    addedAt: fav.added_at
                        ? new Date(fav.added_at).toISOString()
                        : new Date(0).toISOString(),
                    position: 0,
                });
            }
        }

        return results;
    }

    private async getSavedOrder(): Promise<string[]> {
        if (!window.electron?.dbGetAppState) return [];
        try {
            const raw = await window.electron.dbGetAppState(
                GLOBAL_FAVORITES_ORDER_KEY
            );
            if (!raw) return [];
            return JSON.parse(raw) as string[];
        } catch {
            return [];
        }
    }

    private async saveOrder(uidOrder: string[]): Promise<void> {
        if (!window.electron?.dbSetAppState) return;
        try {
            await window.electron.dbSetAppState(
                GLOBAL_FAVORITES_ORDER_KEY,
                JSON.stringify(uidOrder)
            );
        } catch {
            // ignore
        }
    }

    private applyOrder(
        channels: UnifiedFavoriteChannel[],
        savedOrder: string[]
    ): UnifiedFavoriteChannel[] {
        if (!savedOrder.length) {
            // Default: sort by addedAt descending, xtream position asc
            return channels.slice().sort((a, b) => {
                if (a.position !== b.position) return a.position - b.position;
                return (
                    new Date(b.addedAt).getTime() -
                    new Date(a.addedAt).getTime()
                );
            });
        }

        const orderMap = new Map(savedOrder.map((uid, i) => [uid, i]));
        const ordered: UnifiedFavoriteChannel[] = [];
        const unordered: UnifiedFavoriteChannel[] = [];

        for (const ch of channels) {
            const position = orderMap.get(ch.uid);
            if (position != null) {
                ordered.push({ ...ch, position });
            } else {
                unordered.push(ch);
            }
        }

        ordered.sort((a, b) => a.position - b.position);
        unordered.sort(
            (a, b) =>
                new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
        );

        return [...ordered, ...unordered];
    }
}
