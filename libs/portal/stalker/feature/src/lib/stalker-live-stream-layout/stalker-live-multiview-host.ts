import { computed, type Signal } from '@angular/core';
import type {
    MultiviewAnchorHost,
    MultiviewTile,
    MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import {
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

export const STALKER_LIVE_ANCHOR_ID = 'stalker-live';

export interface StalkerLiveMultiviewDeps {
    readonly identity: Signal<{
        readonly sourceId: string;
        readonly contentId: string;
    } | null>;
    readonly playback: Signal<ResolvedPortalPlayback | null>;
    readonly sessionKey: Signal<string>;
    readonly radio: Signal<boolean>;
    readonly player: () => VideoPlayer | undefined;
    /** Plays a channel of the current portal; resolves a fresh link. */
    /** Selects the channel; false when the view does not list it. */
    readonly selectChannel: (channelId: string) => boolean;
}

/**
 * The Stalker live layout as a multiview anchor. Radio plays in the audio
 * player and never becomes a tile; a surviving channel is played again
 * through the layout, which resolves a fresh portal link for it.
 */
export function createStalkerLiveMultiviewHost(
    deps: StalkerLiveMultiviewDeps
): MultiviewAnchorHost {
    const source = computed<MultiviewTileSource | null>(() => {
        const playback = deps.playback();
        const identity = deps.identity();
        const sessionKey = deps.sessionKey();
        if (!playback?.streamUrl || !identity || !sessionKey) return null;
        return {
            playback,
            playbackSessionKey: sessionKey,
            kind: 'live',
            playlistId: identity.sourceId,
            contentId: identity.contentId,
            title: playback.title,
            ...(deps.radio() ? { radio: true } : {}),
        };
    });

    return {
        anchorId: STALKER_LIVE_ANCHOR_ID,
        source,
        engine: computed(() => deps.player() ?? VideoPlayer.VideoJs),
        adopt(tile: MultiviewTile): boolean {
            if (
                !tile.contentId ||
                tile.radio ||
                tile.playlistId !== deps.identity()?.sourceId
            ) {
                return false;
            }
            return deps.selectChannel(tile.contentId);
        },
    };
}
