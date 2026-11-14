import type { Provider, Signal } from '@angular/core';
import { MULTIVIEW_CHANNEL_MAPPER } from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import type { StalkerItvChannel } from '@iptvnator/portal/stalker/data-access';

/** What the Stalker live layout tells its rows' multiview mapper. */
export interface StalkerMultiviewChannelHost {
    readonly multiviewPlaylist: () =>
        { readonly _id: string; readonly title?: string } | null | undefined;
    /** Radio stations never become tiles. */
    readonly isRadioMode: Signal<boolean>;
}

/** A Stalker ITV row as the collection item multiview resolves (R5). */
export function stalkerMultiviewChannelItem(
    playlist: { readonly _id: string; readonly title?: string } | null,
    channel: StalkerItvChannel | null,
    radio = false
): UnifiedCollectionItem | null {
    if (!playlist?._id || channel?.id == null || !channel.cmd) return null;
    return {
        uid: `stalker::${playlist._id}::${channel.id}`,
        name: channel.o_name || channel.name || '',
        logo: channel.logo,
        sourceType: 'stalker',
        contentType: 'live',
        playlistId: playlist._id,
        playlistName: playlist.title ?? '',
        stalkerId: channel.id,
        stalkerCmd: channel.cmd,
        stalkerItem: channel,
        categoryId: channel.tv_genre_id,
        ...(radio ? { radio: 'true' } : {}),
    };
}

/**
 * Multiview badges, Alt+click and drag for the Stalker live layout's rows
 * and its "All items" list. `host` returns the layout component.
 */
export function provideStalkerMultiviewChannels(
    host: () => StalkerMultiviewChannelHost
): Provider {
    return {
        provide: MULTIVIEW_CHANNEL_MAPPER,
        useFactory: () => {
            const layout = host();
            return (row: unknown) =>
                stalkerMultiviewChannelItem(
                    layout.multiviewPlaylist() ?? null,
                    row as StalkerItvChannel | null,
                    layout.isRadioMode()
                );
        },
    };
}
