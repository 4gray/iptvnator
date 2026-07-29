import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
    DatabaseService,
    type DownloadItem,
    PlaylistsService,
} from '@iptvnator/services';
import type { StalkerPortalItem } from '@iptvnator/shared/interfaces';

type PortalSource = 'xtream' | 'stalker';
type StalkerCategory = 'vod' | 'series' | 'itv';
type StalkerFallbackCategory = Exclude<StalkerCategory, 'itv'>;

@Injectable()
export class DownloadLibraryNavigationService {
    private readonly router = inject(Router);
    private readonly db = inject(DatabaseService);
    private readonly playlists = inject(PlaylistsService);

    canOpen(
        item: DownloadItem,
        availablePlaylistIds: ReadonlySet<string>
    ): boolean {
        return (
            availablePlaylistIds.has(item.playlistId) &&
            this.targetId(item) !== null
        );
    }

    async open(item: DownloadItem): Promise<boolean> {
        const targetId = this.targetId(item);
        if (targetId === null) {
            return false;
        }

        const source = await this.resolveSourceType(item.playlistId);
        if (source === null) {
            return false;
        }

        if (source === 'xtream') {
            await this.openXtreamItem(item, targetId);
        } else {
            await this.openStalkerItem(item, targetId);
        }

        return true;
    }

    private targetId(item: DownloadItem): number | null {
        const id =
            item.contentType === 'episode'
                ? (item.seriesXtreamId ?? item.xtreamId)
                : item.xtreamId;

        return Number.isSafeInteger(id) && id > 0 ? id : null;
    }

    private route(
        source: PortalSource,
        playlistId: string,
        segments: Array<string | number>
    ): Array<string | number> {
        return [
            '/workspace',
            source === 'stalker' ? 'stalker' : 'xtreams',
            playlistId,
            ...segments,
        ];
    }

    private async resolveSourceType(
        playlistId: string
    ): Promise<PortalSource | null> {
        try {
            const playlist = await firstValueFrom(
                this.playlists.getPlaylistById(playlistId)
            );
            if (!playlist) {
                return null;
            }

            return playlist.portalUrl && playlist.macAddress
                ? 'stalker'
                : 'xtream';
        } catch {
            return null;
        }
    }

    private async openXtreamItem(
        item: DownloadItem,
        targetId: number
    ): Promise<void> {
        const contentType =
            item.contentType === 'episode' ? 'series' : 'vod';
        const content = await this.db.getContentByXtreamId(
            targetId,
            item.playlistId
        );
        const categoryId = content?.category_id;
        const segments =
            categoryId === null || categoryId === undefined
                ? [contentType]
                : [contentType, String(categoryId), String(targetId)];

        await this.router.navigate(
            this.route('xtream', item.playlistId, segments)
        );
    }

    private normalizePortalItemId(value: unknown): string {
        const raw = String(value ?? '').trim();
        return raw.includes(':') ? raw.split(':')[0] : raw;
    }

    private stalkerCategory(
        value: unknown,
        fallback: StalkerFallbackCategory
    ): StalkerCategory {
        const normalized = String(value ?? '').toLowerCase();
        if (normalized === 'movie') {
            return 'vod';
        }

        return normalized === 'vod' ||
            normalized === 'series' ||
            normalized === 'itv'
            ? normalized
            : fallback;
    }

    private findMatchingStalkerRecentItem(
        items: readonly StalkerPortalItem[],
        targetId: number
    ): StalkerPortalItem | undefined {
        const expectedId = String(targetId);

        return items.find((item) =>
            [item.id, item.movie_id, item.series_id, item.stream_id].some(
                (candidate) =>
                    this.normalizePortalItemId(candidate) === expectedId
            )
        );
    }

    private async stalkerOpenState(
        item: DownloadItem,
        targetId: number,
        fallback: StalkerFallbackCategory
    ): Promise<Record<string, unknown>> {
        try {
            const recent = await firstValueFrom(
                this.playlists.getPortalRecentlyViewed(item.playlistId)
            );
            const matched = this.findMatchingStalkerRecentItem(
                recent,
                targetId
            );

            if (matched) {
                return {
                    ...matched,
                    id:
                        matched.id ??
                        matched.series_id ??
                        matched.movie_id ??
                        String(targetId),
                    category_id: this.stalkerCategory(
                        matched.category_id,
                        fallback
                    ),
                    title: matched.title ?? item.title,
                    name: matched.name ?? matched.o_name ?? item.title,
                };
            }
        } catch {
            // Persisted download metadata is enough to open the recent route.
        }

        return {
            id: String(targetId),
            category_id: fallback,
            title: item.title,
            name: item.title,
            o_name: item.title,
            cover: item.posterUrl,
            logo: item.posterUrl,
        };
    }

    private async openStalkerItem(
        item: DownloadItem,
        targetId: number
    ): Promise<void> {
        const fallback =
            item.contentType === 'episode' ? 'series' : 'vod';
        const openRecentItem = await this.stalkerOpenState(
            item,
            targetId,
            fallback
        );

        await this.router.navigate(
            this.route('stalker', item.playlistId, ['recent']),
            { state: { openRecentItem } }
        );
    }
}
