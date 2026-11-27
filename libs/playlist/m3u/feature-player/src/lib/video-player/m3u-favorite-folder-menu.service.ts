import { computed, inject, Injectable } from '@angular/core';
import { selectFavorites } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { FavoriteChannelFoldersService } from '@iptvnator/portal/shared/data-access';
import { FavoriteFolderDialogs } from '@iptvnator/portal/shared/ui';
import { buildCollectionUid } from '@iptvnator/portal/shared/util';
import {
    playlistDisplayLabel,
    type Channel,
} from '@iptvnator/shared/interfaces';
import type { FavoriteFolderMenuAction } from '@iptvnator/ui/components';
import { Store } from '@ngrx/store';

@Injectable()
export class M3uFavoriteFolderMenuService {
    private readonly folders = inject(FavoriteChannelFoldersService);
    private readonly dialogs = inject(FavoriteFolderDialogs);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly favoriteIds = inject(Store).selectSignal(selectFavorites);

    readonly available = computed(() => {
        const playlist = this.playlistContext.activePlaylist();
        return (
            !!playlist &&
            playlist._id === this.playlistContext.activePlaylistId() &&
            this.folders.folders().length > 0
        );
    });

    constructor() {
        void this.folders.load().catch(() => undefined);
    }

    action(channel: Channel | null): FavoriteFolderMenuAction | null {
        if (!this.available() || !channel?.url?.trim()) return null;
        const ids = this.favoriteIds();
        return ids.some(
            (favorite) => favorite === channel.url || favorite === channel.id
        )
            ? 'move'
            : 'add';
    }

    open(channel: Channel | null, action: FavoriteFolderMenuAction): void {
        const playlist = this.playlistContext.activePlaylist();
        if (!channel || !playlist || this.action(channel) !== action) return;
        const streamUrl = channel.url.trim();
        void this.dialogs.move(
            [
                {
                    uid: buildCollectionUid('m3u', playlist._id, streamUrl),
                    sourceType: 'm3u',
                    contentType: 'live',
                    playlistId: playlist._id,
                    playlistName: playlistDisplayLabel(
                        playlist.title || playlist.filename,
                        'M3U'
                    ),
                    name: channel.name,
                    logo: channel.tvg?.logo,
                    streamUrl: channel.url,
                    channelId: channel.id,
                    radio: channel.radio,
                    m3uChannel: channel,
                },
            ],
            { add: action === 'add' }
        );
    }
}
