import { inject, type Provider } from '@angular/core';
import { MULTIVIEW_CHANNEL_MAPPER } from '@iptvnator/playback/multiview/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import type { Channel } from '@iptvnator/shared/interfaces';

/** An M3U row as the collection item multiview resolves (R5). */
export function m3uMultiviewChannelItem(
    playlist: { readonly _id: string; readonly title?: string } | null,
    channel: Channel | null
): UnifiedCollectionItem | null {
    if (!playlist?._id || !channel?.url) return null;
    return {
        uid: `m3u::${playlist._id}::${channel.id}`,
        name: channel.name,
        logo: channel.tvg?.logo,
        sourceType: 'm3u',
        contentType: 'live',
        playlistId: playlist._id,
        playlistName: playlist.title ?? '',
        channelId: channel.id,
        streamUrl: channel.url,
        tvgId: channel.tvg?.id,
        radio: channel.radio,
        m3uChannel: channel,
    };
}

/** Multiview badges, Alt+click and drag for the M3U channel lists. */
export function provideM3uMultiviewChannels(): Provider {
    return {
        provide: MULTIVIEW_CHANNEL_MAPPER,
        useFactory: () => {
            const context = inject(PlaylistContextFacade);
            return (row: unknown) =>
                m3uMultiviewChannelItem(
                    context.activePlaylist(),
                    row as Channel | null
                );
        },
    };
}
