import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { selectAllPlaylistsMeta } from 'm3u-state';
import { firstValueFrom, map } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import { Channel, Playlist, PlaylistMeta } from 'shared-interfaces';
import {
    buildCollectionUid,
    UnifiedCollectionItem,
} from './unified-collection-item.interface';
import { CollectionScope } from './scope-toggle.service';
import {
    isStalkerItem,
    stalkerContentType,
    xtreamContentType,
    XtreamFavoriteRow,
} from './collection-helpers';

const GLOBAL_FAVORITES_ORDER_KEY = 'global-favorites-channel-order-v1';

type PlaylistWithChannels = Playlist & {
    readonly playlist?: { readonly items?: Channel[] };
};

@Injectable({ providedIn: 'root' })
export class UnifiedFavoritesDataService {
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly translate = inject(TranslateService);

    async getFavorites(
        scope: CollectionScope,
        playlistId?: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        if (scope === 'playlist' && playlistId) {
            return this.getPlaylistFavorites(playlistId, portalType);
        }
        return this.getAllFavorites();
    }

    async removeFavorite(item: UnifiedCollectionItem): Promise<void> {
        switch (item.sourceType) {
            case 'm3u': {
                const playlist = await firstValueFrom(
                    this.playlistsService.getPlaylistById(item.playlistId)
                );
                const filtered = ((playlist.favorites as string[]) ?? [])
                    .filter((f) => f !== item.streamUrl);
                await firstValueFrom(
                    this.playlistsService.setFavorites(item.playlistId, filtered)
                );
                break;
            }
            case 'xtream':
                if (window.electron && item.contentId != null) {
                    await window.electron.dbRemoveFavorite(item.contentId, item.playlistId);
                }
                break;
            case 'stalker': {
                const sourceItemId = item.uid.split('::')[2];
                await firstValueFrom(
                    this.playlistsService.removeFromPortalFavorites(item.playlistId, sourceItemId)
                );
                break;
            }
        }
    }

    async reorder(items: UnifiedCollectionItem[]): Promise<void> {
        const uidOrder = items.map((i) => i.uid);
        const xtreamUpdates = items
            .filter((i) => i.sourceType === 'xtream' && i.contentId != null)
            .map((i, idx) => ({ content_id: i.contentId!, position: idx }));
        await Promise.all([
            xtreamUpdates.length > 0 && window.electron
                ? window.electron.dbReorderGlobalFavorites(xtreamUpdates)
                : Promise.resolve(),
            this.saveOrder(uidOrder),
        ]);
    }

    private async getAllFavorites(): Promise<UnifiedCollectionItem[]> {
        const [m3u, xtream, stalker, order] = await Promise.all([
            this.getM3uFavorites(),
            this.getXtreamAllFavorites(),
            this.getStalkerAllFavorites(),
            this.getSavedOrder(),
        ]);
        return this.applyOrder([...m3u, ...xtream, ...stalker], order);
    }

    private async getPlaylistFavorites(
        playlistId: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        if (portalType === 'xtream') return this.getXtreamPlaylistFavorites(playlistId);
        if (portalType === 'stalker') return this.getStalkerPlaylistFavorites(playlistId);
        return this.getM3uPlaylistFavorites(playlistId);
    }

    private async getM3uFavorites(): Promise<UnifiedCollectionItem[]> {
        const allMeta = await this.getAllMeta();
        const results: UnifiedCollectionItem[] = [];
        for (const meta of allMeta.filter((p) => p._id && !p.serverUrl && !p.macAddress)) {
            results.push(...(await this.extractM3uFavorites(meta)));
        }
        return results;
    }

    private async getM3uPlaylistFavorites(id: string): Promise<UnifiedCollectionItem[]> {
        const meta = await this.getPlaylistMeta(id);
        return meta ? this.extractM3uFavorites(meta) : [];
    }

    private async extractM3uFavorites(meta: PlaylistMeta): Promise<UnifiedCollectionItem[]> {
        if (!meta.favorites?.length) return [];
        const favIds = new Set((meta.favorites as string[]).map(String));
        let playlist: PlaylistWithChannels | undefined;
        try {
            playlist = (await firstValueFrom(
                this.playlistsService.getPlaylistById(meta._id)
            )) as PlaylistWithChannels | undefined;
        } catch { return []; }
        return (playlist?.playlist?.items ?? [])
            .filter((ch) => favIds.has(ch.id) || favIds.has(ch.url))
            .map((ch) => ({
                uid: buildCollectionUid('m3u', meta._id, ch.url || ch.id),
                name: ch.name,
                contentType: 'live' as const,
                sourceType: 'm3u' as const,
                playlistId: meta._id,
                playlistName: meta.title || meta.filename || 'M3U',
                logo: ch.tvg?.logo ?? null,
                streamUrl: ch.url,
                tvgId: ch.tvg?.id || ch.tvg?.name || ch.name,
                addedAt: new Date(0).toISOString(),
                position: 0,
            }));
    }

    private async getXtreamAllFavorites(): Promise<UnifiedCollectionItem[]> {
        if (!window.electron?.dbGetAllGlobalFavorites) return [];
        try {
            const rows = (await this.dbService.getAllGlobalFavorites()) as XtreamFavoriteRow[];
            return rows.map((r) => this.mapXtreamRow(r));
        } catch { return []; }
    }

    private async getXtreamPlaylistFavorites(playlistId: string): Promise<UnifiedCollectionItem[]> {
        if (!window.electron) return [];
        try {
            const rows = await this.dbService.getFavorites(playlistId);
            const meta = await this.getPlaylistMeta(playlistId);
            return (rows as unknown as XtreamFavoriteRow[]).map((r) => ({
                ...this.mapXtreamRow(r),
                playlistId,
                playlistName: meta?.title || 'Xtream',
            }));
        } catch { return []; }
    }

    private mapXtreamRow(row: XtreamFavoriteRow): UnifiedCollectionItem {
        const ct = xtreamContentType(row.type);
        return {
            uid: buildCollectionUid('xtream', row.playlist_id, row.xtream_id),
            name: row.title,
            contentType: ct,
            sourceType: 'xtream',
            playlistId: row.playlist_id,
            playlistName: row.playlist_name ?? 'Xtream',
            logo: ct === 'live' ? (row.poster_url ?? null) : null,
            posterUrl: ct !== 'live' ? (row.poster_url ?? null) : null,
            xtreamId: row.xtream_id,
            categoryId: row.category_id,
            tvgId: ct === 'live' ? String(row.xtream_id) : undefined,
            rating: row.rating ?? undefined,
            addedAt: row.added_at ?? new Date(0).toISOString(),
            position: row.position ?? 0,
            contentId: row.id,
        };
    }

    private async getStalkerAllFavorites(): Promise<UnifiedCollectionItem[]> {
        const allMeta = await this.getAllMeta();
        const results: UnifiedCollectionItem[] = [];
        for (const meta of allMeta.filter((p) => p._id && p.macAddress)) {
            results.push(...(await this.extractStalkerFavorites(meta)));
        }
        return results;
    }

    private async getStalkerPlaylistFavorites(id: string): Promise<UnifiedCollectionItem[]> {
        const meta = await this.getPlaylistMeta(id);
        return meta ? this.extractStalkerFavorites(meta) : [];
    }

    private async extractStalkerFavorites(meta: PlaylistMeta): Promise<UnifiedCollectionItem[]> {
        if (!meta.favorites?.length) return [];
        let playlist: Playlist | undefined;
        try {
            playlist = (await firstValueFrom(
                this.playlistsService.getPlaylistById(meta._id)
            )) as Playlist | undefined;
        } catch { return []; }
        const favs = Array.isArray(playlist?.favorites)
            ? playlist.favorites.filter(isStalkerItem) : [];
        return favs.map((fav) => {
            const ct = stalkerContentType(fav);
            return {
                uid: buildCollectionUid('stalker', meta._id, fav.stream_id ?? fav.id),
                name: fav.o_name || fav.name || this.translate.instant('WORKSPACE.GLOBAL_FAVORITES.UNKNOWN_CHANNEL'),
                contentType: ct,
                sourceType: 'stalker' as const,
                playlistId: meta._id,
                playlistName: meta.title || meta.filename || this.translate.instant('WORKSPACE.DASHBOARD.STALKER_PORTAL'),
                logo: ct === 'live' ? (fav.logo ?? fav.cover ?? null) : null,
                posterUrl: ct !== 'live' ? (fav.logo ?? fav.cover ?? null) : null,
                stalkerCmd: fav.cmd,
                stalkerPortalUrl: playlist?.portalUrl ?? playlist?.url,
                stalkerMacAddress: playlist?.macAddress,
                categoryId: fav.category_id,
                stalkerItem: fav,
                addedAt: fav.added_at ? new Date(fav.added_at).toISOString() : new Date(0).toISOString(),
                position: 0,
            };
        });
    }

    private async getAllMeta(): Promise<PlaylistMeta[]> {
        return firstValueFrom(
            this.store.select(selectAllPlaylistsMeta).pipe(map((m) => m as PlaylistMeta[]))
        );
    }

    private async getPlaylistMeta(id: string): Promise<PlaylistMeta | undefined> {
        return (await this.getAllMeta()).find((p) => p._id === id);
    }

    private async getSavedOrder(): Promise<string[]> {
        if (!window.electron?.dbGetAppState) return [];
        try {
            const raw = await window.electron.dbGetAppState(GLOBAL_FAVORITES_ORDER_KEY);
            return raw ? (JSON.parse(raw) as string[]) : [];
        } catch { return []; }
    }

    private async saveOrder(uidOrder: string[]): Promise<void> {
        if (!window.electron?.dbSetAppState) return;
        try {
            await window.electron.dbSetAppState(GLOBAL_FAVORITES_ORDER_KEY, JSON.stringify(uidOrder));
        } catch { /* ignore */ }
    }

    private applyOrder(items: UnifiedCollectionItem[], savedOrder: string[]): UnifiedCollectionItem[] {
        if (!savedOrder.length) {
            return items.slice().sort((a, b) => {
                const pa = a.position ?? 0, pb = b.position ?? 0;
                if (pa !== pb) return pa - pb;
                return new Date(b.addedAt ?? 0).getTime() - new Date(a.addedAt ?? 0).getTime();
            });
        }
        const orderMap = new Map(savedOrder.map((uid, i) => [uid, i]));
        const ordered: UnifiedCollectionItem[] = [];
        const unordered: UnifiedCollectionItem[] = [];
        for (const item of items) {
            const pos = orderMap.get(item.uid);
            pos != null ? ordered.push({ ...item, position: pos }) : unordered.push(item);
        }
        ordered.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        unordered.sort((a, b) => new Date(b.addedAt ?? 0).getTime() - new Date(a.addedAt ?? 0).getTime());
        return [...ordered, ...unordered];
    }
}
