import { DecimalPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { selectActivePlaylist, selectAllPlaylistsMeta } from 'm3u-state';
import { PlaylistMeta } from 'shared-interfaces';

@Component({
    selector: 'app-dashboard-placeholder',
    imports: [DecimalPipe, MatButton, MatIcon, RouterLink],
    templateUrl: './dashboard-placeholder.component.html',
    styleUrl: './dashboard-placeholder.component.scss',
})
export class DashboardPlaceholderComponent {
    private readonly store = inject(Store);

    readonly activePlaylist = this.store.selectSignal(selectActivePlaylist);
    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);

    readonly stats = computed(() => {
        const items = this.playlists();
        return {
            total: items.length,
            xtream: items.filter((item) => !!item.serverUrl).length,
            stalker: items.filter((item) => !!item.macAddress).length,
            m3u: items.filter((item) => !item.serverUrl && !item.macAddress)
                .length,
        };
    });

    readonly recentPlaylists = computed(() =>
        [...this.playlists()]
            .sort(
                (a, b) =>
                    this.getRecentTimestamp(b) - this.getRecentTimestamp(a)
            )
            .slice(0, 8)
    );

    getPlaylistLink(playlist: PlaylistMeta): string[] {
        if (playlist.serverUrl) {
            return ['/workspace', 'xtreams', playlist._id, 'vod'];
        }

        if (playlist.macAddress) {
            return ['/workspace', 'stalker', playlist._id, 'vod'];
        }

        return ['/workspace', 'playlists', playlist._id];
    }

    getPlaylistProvider(playlist: PlaylistMeta): 'Xtream' | 'Stalker' | 'M3U' {
        if (playlist.serverUrl) {
            return 'Xtream';
        }

        if (playlist.macAddress) {
            return 'Stalker';
        }

        return 'M3U';
    }

    trackByPlaylistId(_: number, item: PlaylistMeta): string {
        return item._id;
    }

    formatTimestamp(value?: string | number): string {
        const timestamp = this.toTimestamp(value);
        if (!timestamp) {
            return 'Not yet synced';
        }

        return new Date(timestamp).toLocaleString();
    }

    private getRecentTimestamp(item: PlaylistMeta): number {
        return (
            this.toTimestamp(item.updateDate) ||
            this.toTimestamp(item.importDate)
        );
    }

    private toTimestamp(value?: string | number): number {
        if (typeof value === 'number') {
            return value;
        }

        if (typeof value === 'string') {
            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? 0 : parsed;
        }

        return 0;
    }
}
