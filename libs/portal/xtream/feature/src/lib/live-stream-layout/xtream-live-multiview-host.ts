import { computed, type Signal } from '@angular/core';
import type {
    MultiviewAnchorHost,
    MultiviewTile,
    MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import {
    type EpgProgram,
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

export const XTREAM_LIVE_ANCHOR_ID = 'xtream-live';

export interface XtreamLiveMultiviewDeps {
    readonly playlistId: () => string | undefined;
    readonly playback: Signal<ResolvedPortalPlayback | null>;
    readonly sessionKey: Signal<string>;
    readonly channelId: Signal<number | null>;
    readonly catchupProgram: Signal<EpgProgram | null>;
    readonly player: () => VideoPlayer | undefined;
    /** Selects and plays a channel of the current playlist; false if absent. */
    readonly selectChannel: (channelId: number) => boolean;
}

/**
 * The Xtream live layout as a multiview anchor. A catch-up programme is its
 * own source (paused without audio like a VOD), distinct from the channel's
 * live stream.
 */
export function createXtreamLiveMultiviewHost(
    deps: XtreamLiveMultiviewDeps
): MultiviewAnchorHost {
    const source = computed<MultiviewTileSource | null>(() => {
        const playback = deps.playback();
        const sessionKey = deps.sessionKey();
        const playlistId = deps.playlistId();
        const channelId = deps.channelId();
        if (!playback?.streamUrl || !sessionKey || !playlistId) return null;
        const catchup = deps.catchupProgram();
        return {
            playback,
            playbackSessionKey: catchup
                ? `${sessionKey}|catchup:${catchup.start}`
                : sessionKey,
            kind: catchup ? 'vod' : 'live',
            playlistId,
            contentId: channelId === null ? undefined : String(channelId),
            title: playback.title,
        };
    });

    return {
        anchorId: XTREAM_LIVE_ANCHOR_ID,
        source,
        engine: computed(() => deps.player() ?? VideoPlayer.VideoJs),
        adopt(tile: MultiviewTile): boolean {
            // Catch-up survivors and other playlists cannot be selected here.
            if (
                tile.kind !== 'live' ||
                !tile.contentId ||
                tile.playlistId !== deps.playlistId()
            ) {
                return false;
            }
            return deps.selectChannel(Number(tile.contentId));
        },
    };
}
