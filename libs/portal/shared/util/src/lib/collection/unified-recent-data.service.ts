import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { selectAllPlaylistsMeta } from 'm3u-state';
import { firstValueFrom, map } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import {
    buildPlaylistRecentItems,
    Playlist,
    PlaylistMeta,
} from 'shared-interfaces';
import {
    buildCollectionUid,
    UnifiedCollectionItem,
} from './unified-collection-item.interface';
import { CollectionScope } from './scope-toggle.service';
import { xtreamContentType } from './collection-helpers';

@Injectable({ providedIn: 'root' })
export class UnifiedRecentDataService {
    private readonly store = inject(Store);
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);

    async getRecentItems(
        scope: CollectionScope,
        playlistId?: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        if (scope === 'playlist' && playlistId) {
            return this.getPlaylistRecentItems(playlistId, portalType);
        }
        return this.getAllRecentItems();
    }

    async removeRecentItem(item: UnifiedCollectionItem): Promise<void> {
        if (item.sourceType === 'xtream' && item.contentId != null) {
            await this.dbService.removeRecentItem(
                item.contentId,
                item.playlistId
            );
        } else if (item.sourceType === 'stalker' || item.sourceType === 'm3u') {
            const sourceItemId = item.uid.split('::')[2];
            await firstValueFrom(
                this.playlistsService.removeFromPortalRecentlyViewed(
                    item.playlistId,
                    sourceItemId
                )
            );
        }
    }

    async clearRecentItems(
        scope: CollectionScope,
        playlistId?: string
    ): Promise<void> {
        if (scope === 'playlist' && playlistId) {
            await this.dbService.clearPlaylistRecentItems(playlistId);
            await firstValueFrom(
                this.playlistsService.clearPlaylistRecentlyViewed(playlistId)
            );
        } else {
            await this.dbService.clearGlobalRecentlyViewed();
            const playlists = (await firstValueFrom(
                this.playlistsService.getAllPlaylists()
            )) as Playlist[];
            await Promise.all(
                playlists
                    .filter((p) => Boolean(p.macAddress) || !p.serverUrl)
                    .map((p) =>
                        firstValueFrom(
                            this.playlistsService.clearPlaylistRecentlyViewed(p._id)
                        )
                    )
            );
        }
    }

    // ─── Private ──────────────────────────────────────

    private async getAllRecentItems(): Promise<UnifiedCollectionItem[]> {
        const [xtream, playlistBased] = await Promise.all([
            this.getXtreamGlobalRecent(),
            this.getPlaylistBasedRecent(),
        ]);
        return [...xtream, ...playlistBased].sort(
            (a, b) =>
                new Date(b.viewedAt ?? 0).getTime() -
                new Date(a.viewedAt ?? 0).getTime()
        );
    }

    private async getPlaylistRecentItems(
        playlistId: string,
        portalType?: string
    ): Promise<UnifiedCollectionItem[]> {
        if (portalType === 'xtream') {
            return this.getXtreamPlaylistRecent(playlistId);
        }
        if (portalType === 'stalker') {
            return this.getStalkerPlaylistRecent(playlistId);
        }
        return this.getM3uPlaylistRecent(playlistId);
    }

    private async getXtreamGlobalRecent(): Promise<UnifiedCollectionItem[]> {
        try {
            const rows = await this.dbService.getGlobalRecentlyViewed();
            return (rows || []).map((row) => ({
                uid: buildCollectionUid('xtream', row.playlist_id, row.xtream_id),
                name: row.title,
                contentType: xtreamContentType(row.type),
                sourceType: 'xtream' as const,
                playlistId: row.playlist_id,
                playlistName: row.playlist_name ?? 'Xtream',
                logo: row.type === 'live' ? (row.poster_url ?? null) : null,
                posterUrl: row.type !== 'live' ? (row.poster_url ?? null) : null,
                xtreamId: row.xtream_id,
                categoryId: row.category_id,
                tvgId: row.type === 'live' ? String(row.xtream_id) : undefined,
                contentId: row.id,
                viewedAt: row.viewed_at,
            }));
        } catch {
            return [];
        }
    }

    private async getXtreamPlaylistRecent(
        playlistId: string
    ): Promise<UnifiedCollectionItem[]> {
        try {
            const rows = await this.dbService.getRecentItems(playlistId);
            const meta = await this.getPlaylistMeta(playlistId);
            return (rows || []).map((row) => ({
                uid: buildCollectionUid('xtream', playlistId, row.xtream_id),
                name: row.title,
                contentType: xtreamContentType(row.type),
                sourceType: 'xtream' as const,
                playlistId,
                playlistName: meta?.title || 'Xtream',
                logo: row.type === 'live' ? (row.poster_url ?? null) : null,
                posterUrl: row.type !== 'live' ? (row.poster_url ?? null) : null,
                xtreamId: row.xtream_id,
                categoryId: row.category_id,
                tvgId: row.type === 'live' ? String(row.xtream_id) : undefined,
                contentId: row.id,
                viewedAt: row.viewed_at ?? '',
            }));
        } catch {
            return [];
        }
    }

    private async getPlaylistBasedRecent(): Promise<UnifiedCollectionItem[]> {
        const playlists = (await firstValueFrom(
            this.playlistsService.getAllPlaylists()
        )) as Playlist[];
        const items = buildPlaylistRecentItems(playlists, {
            stalker: 'Stalker Portal',
            m3u: 'M3U',
        });
        return items.map((item) => ({
            uid: buildCollectionUid(
                (item.source as 'm3u' | 'stalker') ?? 'm3u',
                item.playlist_id,
                item.id
            ),
            name: item.title,
            contentType: xtreamContentType(item.type),
            sourceType: (item.source as 'm3u' | 'stalker') ?? 'm3u',
            playlistId: item.playlist_id,
            playlistName: item.playlist_name ?? '',
            logo: item.type === 'live' ? (item.poster_url ?? null) : null,
            posterUrl: item.type !== 'live' ? (item.poster_url ?? null) : null,
            stalkerItem: item.stalker_item,
            viewedAt: item.viewed_at,
        }));
    }

    private async getStalkerPlaylistRecent(
        playlistId: string
    ): Promise<UnifiedCollectionItem[]> {
        const all = await this.getPlaylistBasedRecent();
        return all.filter(
            (i) => i.sourceType === 'stalker' && i.playlistId === playlistId
        );
    }

    private async getM3uPlaylistRecent(
        playlistId: string
    ): Promise<UnifiedCollectionItem[]> {
        const all = await this.getPlaylistBasedRecent();
        return all.filter(
            (i) => i.sourceType === 'm3u' && i.playlistId === playlistId
        );
    }

    private async getPlaylistMeta(
        id: string
    ): Promise<PlaylistMeta | undefined> {
        const all = await firstValueFrom(
            this.store.select(selectAllPlaylistsMeta)
                .pipe(map((m) => m as PlaylistMeta[]))
        );
        return all.find((p) => p._id === id);
    }
}
