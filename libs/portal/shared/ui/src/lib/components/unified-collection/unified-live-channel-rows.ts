import { computed, Signal } from '@angular/core';
import {
    deriveVisibleFavoriteChannels,
    FavoritesChannelSortMode,
    UnifiedCollectionItem,
    UnifiedFavoriteChannel,
} from '@iptvnator/portal/shared/util';

export interface UnifiedLiveChannelRows {
    /** Every collection row, as the shared list renders them. */
    readonly all: Signal<UnifiedFavoriteChannel[]>;
    /**
     * The channel list in exactly the order the sidebar renders it
     * (search-filtered; sorted in favorites mode) — remote-control
     * navigation and channel numbers must follow what is on screen.
     */
    readonly visible: Signal<readonly UnifiedFavoriteChannel[]>;
    /**
     * Rows for the fullscreen channel panel. Radio is withheld: it renders
     * through `app-audio-player` instead of `app-web-player-view`, so
     * selecting a station destroys the element that owns fullscreen and
     * drops the user out of it — the opposite of what the panel exists for.
     * The page's own list keeps every row.
     */
    readonly fullscreenPanel: Signal<UnifiedFavoriteChannel[]>;
}

export function createUnifiedLiveChannelRows(options: {
    items: Signal<UnifiedCollectionItem[]>;
    searchTerm: Signal<string>;
    mode: Signal<'favorites' | 'recent'>;
    sortMode: Signal<FavoritesChannelSortMode>;
}): UnifiedLiveChannelRows {
    const all = computed((): UnifiedFavoriteChannel[] =>
        options.items().map(toUnifiedFavoriteChannel)
    );

    return {
        all,
        visible: computed(() =>
            deriveVisibleFavoriteChannels(all(), {
                searchTerm: options.searchTerm(),
                sortMode:
                    options.mode() === 'favorites' ? options.sortMode() : null,
                getName: (channel) => channel.name,
                getAddedAt: (channel) => channel.addedAt,
            })
        ),
        fullscreenPanel: computed(() =>
            all().filter((channel) => channel.radio !== 'true')
        ),
    };
}

/**
 * Project a collection row onto the channel shape the shared favorites list
 * renders. The two differ because a collection row also carries VOD fields
 * the live rail has no use for.
 */
export function toUnifiedFavoriteChannel(
    item: UnifiedCollectionItem
): UnifiedFavoriteChannel {
    return {
        uid: item.uid,
        name: item.name,
        logo: item.logo ?? null,
        sourceType: item.sourceType,
        playlistId: item.playlistId,
        playlistName: item.playlistName,
        streamUrl: item.streamUrl,
        m3uChannel: item.m3uChannel,
        radio: item.radio,
        xtreamId: item.xtreamId,
        tvArchive: item.tvArchive ?? null,
        tvArchiveDuration: item.tvArchiveDuration ?? null,
        tvgId: item.tvgId,
        stalkerCmd: item.stalkerCmd,
        stalkerPortalUrl: item.stalkerPortalUrl,
        stalkerMacAddress: item.stalkerMacAddress,
        addedAt: item.addedAt ?? new Date(0).toISOString(),
        position: item.position ?? 0,
        contentId: item.contentId,
    };
}
