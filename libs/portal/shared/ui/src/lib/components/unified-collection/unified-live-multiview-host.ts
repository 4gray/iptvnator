import { computed, type Signal } from '@angular/core';
import type {
    MultiviewAnchorHost,
    MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import type {
    UnifiedCollectionItem,
    UnifiedFavoriteChannel,
} from '@iptvnator/portal/shared/util';
import type {
    ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    injectMultiviewAnchor,
    type MultiviewAnchor,
    MultiviewAnchorPlaceholderComponent,
    MultiviewPlayerDirective,
} from '@iptvnator/ui/playback/multiview-anchor';
import type { UnifiedLiveTimeshift } from './unified-live-catchup';

export const UNIFIED_LIVE_ANCHOR_ID = 'unified-live';

/** What the unified live tab exposes to its multiview anchor. */
export interface UnifiedLiveMultiviewTab {
    readonly inlinePlayback: Signal<ResolvedPortalPlayback | null>;
    readonly playbackSessionKey: Signal<string>;
    readonly activeItem: Signal<UnifiedCollectionItem | null>;
    readonly activeTimeshift: Signal<UnifiedLiveTimeshift | null>;
    readonly isRadioSelection: Signal<boolean>;
    readonly inlinePlayer: Signal<VideoPlayer>;
    readonly items: Signal<UnifiedCollectionItem[]>;
    onChannelSelected(channel: UnifiedFavoriteChannel): Promise<void>;
}

/** The anchor's template parts, for the tab's `imports`. */
export const UNIFIED_LIVE_MULTIVIEW_IMPORTS = [
    MultiviewAnchorPlaceholderComponent,
    MultiviewPlayerDirective,
] as const;

/**
 * The Favorites / Recently viewed live tab as a multiview anchor. Rows are
 * identified by their collection uid, so a surviving row of this list is
 * selected again when a session ends; catch-up counts as its own VOD-like
 * source and radio never becomes a tile.
 */
export function createUnifiedLiveMultiviewHost(
    tab: UnifiedLiveMultiviewTab
): MultiviewAnchorHost {
    const source = computed<MultiviewTileSource | null>(() => {
        const playback = tab.inlinePlayback();
        const sessionKey = tab.playbackSessionKey();
        const item = tab.activeItem();
        if (!playback?.streamUrl || !sessionKey || !item) return null;
        const timeshift = tab.activeTimeshift();
        return {
            playback,
            playbackSessionKey: timeshift
                ? `${sessionKey}|catchup:${playback.streamUrl}`
                : sessionKey,
            kind: timeshift ? 'vod' : 'live',
            playlistId: item.playlistId,
            contentId: timeshift ? undefined : item.uid,
            title: playback.title,
            ...(tab.isRadioSelection() ? { radio: true } : {}),
        };
    });

    return {
        anchorId: UNIFIED_LIVE_ANCHOR_ID,
        source,
        engine: computed(() => tab.inlinePlayer()),
        adopt(tile): boolean {
            const row = tab.items().find((item) => item.uid === tile.contentId);
            if (!row) return false;
            void tab.onChannelSelected({
                uid: row.uid,
            } as UnifiedFavoriteChannel);
            return true;
        },
    };
}

/** Creates the tab's anchor; call in a field initializer. */
export function createUnifiedLiveMultiviewAnchor(
    tab: UnifiedLiveMultiviewTab
): MultiviewAnchor {
    return injectMultiviewAnchor(createUnifiedLiveMultiviewHost(tab));
}
