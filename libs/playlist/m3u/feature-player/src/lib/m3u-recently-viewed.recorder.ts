import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistsService } from '@iptvnator/services';
import {
    Channel,
    M3uRecentlyViewedItem,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';

/**
 * Writes one M3U row to its playlist's Recently viewed and publishes the
 * updated list to the store, which the in-player Recent list and the
 * dashboard read.
 *
 * Shared by every M3U surface that plays a row — the channel player and
 * the Series page — so an episode watched on either is remembered the
 * same way. Callers decide WHEN to call it: inline playback only after
 * `PlaybackHistoryGate` confirms the stream really played.
 */
@Injectable({ providedIn: 'root' })
export class M3uRecentlyViewedRecorder {
    private readonly playlistsService = inject(PlaylistsService);
    private readonly store = inject(Store);

    async persist(playlistId: string, channel: Channel): Promise<void> {
        const item: M3uRecentlyViewedItem = {
            source: 'm3u',
            id: channel.url,
            url: channel.url,
            title: channel.name?.trim() || channel.tvg?.name || channel.url,
            channel_id: channel.id,
            poster_url: channel.tvg?.logo || undefined,
            tvg_id: channel.tvg?.id || undefined,
            tvg_name: channel.tvg?.name || undefined,
            group_title: channel.group?.title || undefined,
            category_id: 'live',
            added_at: new Date().toISOString(),
        };

        const updatedPlaylist = await firstValueFrom(
            this.playlistsService.addM3uRecentlyViewed(playlistId, item)
        );

        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({
                persist: false,
                playlist: {
                    _id: playlistId,
                    recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                } as PlaylistMeta,
            })
        );
    }
}
